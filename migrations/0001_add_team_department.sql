-- Link teams to departments for manager scoping and routing validation
ALTER TABLE "teams" ADD COLUMN IF NOT EXISTS "department_id" integer;
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_id_departments_id_fk"
  FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX IF NOT EXISTS idx_teams_department ON teams(department_id);


