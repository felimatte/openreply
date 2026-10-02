import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { normalizeZernioEvent, verifyZernioSignature } from '@/lib/zernio/normalize-event';
import { parseCommentEvents, parseMessageEvents, parsePostbackEvents, parseReadEvents } from '@/lib/meta/webhook';

const account = { zernioAccountId: 'za1', instagramId: 'ig1' };
const envelope = { id: 'evt1', account: { id: 'za1', platform: 'instagram' } };

describe('Zernio event boundary', () => {
  it('verifies the exact body using the workspace secret', () => {
    const rawBody = '{"id":"event"}';
    const signature = createHmac('sha256', 'secret').update(rawBody).digest('hex');
    expect(verifyZernioSignature({ rawBody, signature, secret: 'secret' })).toBe(true);
    expect(verifyZernioSignature({ rawBody: rawBody + ' ', signature, secret: 'secret' })).toBe(false);
    expect(verifyZernioSignature({ rawBody, signature, secret: 'other-workspace' })).toBe(false);
    expect(verifyZernioSignature({ rawBody, signature: null, secret: 'secret' })).toBe(false);
  });
  it('maps native post and comment ids for existing campaign matching', () => {
    const payload = { ...envelope, event: 'comment.received', comment: { id: 'comment1', text: 'LINK', author: { id: 'person1', username: 'reader' }, platformPostId: 'media1' }, post: { id: 'internal1', platformPostId: 'media1' } };
    const result = normalizeZernioEvent({ payload, account });
    expect(parseCommentEvents(result!)).toEqual([{ instagramAccountId: 'ig1', commentId: 'comment1', commentText: 'LINK', commenterId: 'person1', commenterName: 'reader', mediaId: 'media1', originalMediaId: undefined }]);
    expect(normalizeZernioEvent({ payload, account: { ...account, zernioAccountId: 'other' } })).toBeNull();
  });
  it('excludes self comments and outgoing message echoes', () => {
    const comment = normalizeZernioEvent({ payload: { ...envelope, event: 'comment.received', comment: { id: 'c', platformPostId: 'p', text: 'LINK', author: { id: 'ig1' } } }, account });
    expect(parseCommentEvents(comment!)).toEqual([]);
    expect(normalizeZernioEvent({ payload: { ...envelope, event: 'message.received', message: { platformMessageId: 'm', direction: 'outgoing', text: 'LINK', sender: { id: 'person1' } } }, account })).toBeNull();
  });
  it('maps postbacks without also triggering a keyword DM', () => {
    const result = normalizeZernioEvent({ account, payload: { ...envelope, event: 'message.received', message: { platformMessageId: 'native-mid', direction: 'incoming', text: 'LINK', sender: { id: 'person1' } }, metadata: { postbackPayload: 'reveal:campaign1', postbackTitle: 'Open' } } });
    expect(parsePostbackEvents(result!)).toEqual([{ instagramAccountId: 'ig1', userId: 'person1', payload: 'reveal:campaign1', mid: 'native-mid' }]);
    expect(parseMessageEvents(result!)).toEqual([]);
  });
  it('maps inbound story text and read receipts to their existing handlers', () => {
    const result = normalizeZernioEvent({ account, payload: { ...envelope, event: 'message.received', message: { platformMessageId: 'mid', direction: 'incoming', text: 'LINK', sender: { id: 'person1' } } } });
    expect(parseMessageEvents(result!)[0]).toEqual({ instagramAccountId: 'ig1', messageId: 'mid', messageText: 'LINK', senderId: 'person1' });
    const read = normalizeZernioEvent({ account, payload: { ...envelope, event: 'message.read', conversation: { participantId: 'person1' }, statusAt: '2026-09-08T00:00:00Z' } });
    expect(parseReadEvents(read!)[0]).toEqual({ instagramAccountId: 'ig1', userId: 'person1', watermark: 1788825600000 });
  });
  it('rejects malformed and unrelated events', () => {
    for (const payload of [null, {}, { ...envelope, event: 'post.published' }, { ...envelope, event: 'message.received', message: {} }]) {
      expect(normalizeZernioEvent({ payload, account })).toBeNull();
    }
  });
  it('preserves the original envelope time across delayed message retries', () => {
    const timestamp = '2026-09-28T10:00:00Z';
    const payload = { ...envelope, timestamp, event: 'message.received', message: { platformMessageId: 'original-mid', direction: 'incoming', text: 'SI', sender: { id: 'person1' } } };
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse(timestamp) + 1000);
    try {
      const first = normalizeZernioEvent({ payload, account });
      clock.mockReturnValue(Date.parse(timestamp) + 7 * 86400000);
      const replay = normalizeZernioEvent({ payload, account });
      expect(replay).toEqual(first); expect(parseMessageEvents(replay!)[0].timestamp).toBe(Date.parse(timestamp));
      expect(clock).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
  });
  it('uses the same original timestamp for comment and continuation events', () => {
    const timestamp = '2026-09-28T10:00:00Z';
    const comment = normalizeZernioEvent({ account, payload: { ...envelope, timestamp, event: 'comment.received', comment: { id: 'comment', platformPostId: 'reel', text: 'GUIA', author: { id: 'person1' } } } });
    const button = normalizeZernioEvent({ account, payload: { ...envelope, timestamp, event: 'message.received', message: { platformMessageId: 'tap', direction: 'incoming', text: 'Seguir', sender: { id: 'person1' } }, metadata: { postbackPayload: 'flow.opaque' } } });
    expect(parseCommentEvents(comment!)[0].timestamp).toBe(Date.parse(timestamp)); expect(parsePostbackEvents(button!)[0].timestamp).toBe(Date.parse(timestamp));
  });
  it('does not invent an opt-in timestamp for an undated provider event', () => {
    const result = normalizeZernioEvent({ account, payload: { ...envelope, event: 'message.received', message: { platformMessageId: 'undated', direction: 'incoming', text: 'SI', sender: { id: 'person1' } } } });
    expect(result!.entry[0].time).toBe(0); expect(parseMessageEvents(result!)[0]).not.toHaveProperty('timestamp');
  });
});
