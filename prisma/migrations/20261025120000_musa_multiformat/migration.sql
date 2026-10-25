-- Additive, ordered progress. Legacy publications keep an empty child list and their hashes.
ALTER TABLE "MusaPublication" ADD COLUMN "childContainerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "MusaPublication" ADD CONSTRAINT "MusaPublication_children_check" CHECK (
  cardinality("childContainerIds") <= 10
  AND (cardinality("childContainerIds") = 0 OR array_ndims("childContainerIds") = 1)
  AND array_position("childContainerIds", NULL) IS NULL
);
-- A child receipt never proves that the parent carousel was published.
ALTER TABLE "MusaPublication" ADD CONSTRAINT "MusaPublication_parent_check" CHECK (
  "containerId" IS NULL OR NOT ("containerId" = ANY("childContainerIds"))
);
