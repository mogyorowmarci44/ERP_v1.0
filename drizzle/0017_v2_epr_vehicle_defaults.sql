-- EPR: minden meglévő gépkocsi M1 kategória, belső égésű hajtás (ahol még nincs megadva).
UPDATE "vehicles" SET "epr_category" = 'M1' WHERE "epr_category" IS NULL;--> statement-breakpoint
UPDATE "vehicles" SET "epr_drive" = 'ice' WHERE "epr_drive" IS NULL;
