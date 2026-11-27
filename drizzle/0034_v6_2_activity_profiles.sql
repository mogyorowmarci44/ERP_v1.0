-- v6.2.0 – új tevékenységprofilok (a modulok kiinduló beállításához)
ALTER TYPE "activity_profile" ADD VALUE IF NOT EXISTS 'services';
--> statement-breakpoint
ALTER TYPE "activity_profile" ADD VALUE IF NOT EXISTS 'trade';
