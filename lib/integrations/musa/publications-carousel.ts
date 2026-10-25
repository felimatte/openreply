import type { MusaPublication, Prisma } from "@/app/generated/prisma/client";
import type { InstagramContext } from "@/lib/instagram/context";
import { publicationMedia, type MusaPublicationInput } from "./publications-policy";
import { createMetaCarouselChild, createMetaCarouselContainer, metaContainerStatus, MusaProviderError } from "./publications-provider";

interface CarouselStep {
  row: MusaPublication;
  provider: InstagramContext;
  instagramId: string;
  payload: MusaPublicationInput;
  save: (data: Prisma.MusaPublicationUpdateManyMutationInput) => Promise<void>;
}

/** Each step uses the publication lease, persists progress, and performs at most one provider operation. */
export async function advanceMetaCarousel({ row, provider, instagramId, payload, save }: CarouselStep) {
  const media = publicationMedia(payload), children = row.childContainerIds;
  if (provider.provider !== "META" || children.length > media.length || new Set(children).size !== children.length)
    throw new MusaProviderError("PUBLICATION_STATE_INVALID", true);
  if (row.stage === "READY") {
    const item = media[children.length];
    if (!item) throw new MusaProviderError("PUBLICATION_STATE_INVALID", true);
    await save({ stage: "META_CHILD_CREATING", attemptStartedAt: new Date() });
    const id = await createMetaCarouselChild(provider, instagramId, item);
    if (children.includes(id)) throw new MusaProviderError("PROVIDER_INVALID_RESPONSE", true);
    await save({ stage: "META_CHILD_PROCESSING", childContainerIds: [...children, id],
      nextAttemptAt: new Date(Date.now() + 30_000) });
  } else if (row.stage === "META_CHILD_PROCESSING") {
    const id = children.at(-1);
    if (!id) throw new MusaProviderError("PUBLICATION_STATE_INVALID", true);
    const status = await metaContainerStatus(provider, id);
    if (status === "FINISHED") await save({ stage: children.length === media.length ? "META_PARENT_READY" : "READY", nextAttemptAt: null });
    else if (status === "ERROR" || status === "EXPIRED") throw new MusaProviderError(`MEDIA_${status}`);
    else if (status === "PUBLISHED") throw new MusaProviderError("CAROUSEL_CHILD_ALREADY_PUBLISHED");
    else await save({ nextAttemptAt: new Date(Date.now() + 60_000) });
  } else if (row.stage === "META_PARENT_READY") {
    if (children.length !== media.length || children.length < 2) throw new MusaProviderError("PUBLICATION_STATE_INVALID", true);
    await save({ stage: "META_CREATING", attemptStartedAt: new Date() });
    const containerId = await createMetaCarouselContainer(provider, instagramId, payload.caption, children);
    await save({ stage: "META_PROCESSING", containerId, nextAttemptAt: new Date(Date.now() + 30_000) });
  } else throw new MusaProviderError("PUBLICATION_STATE_INVALID", true);
}
