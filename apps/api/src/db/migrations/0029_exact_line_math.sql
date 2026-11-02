-- Lines saved from now on use exact whole-number maths; existing lines keep their issued floating-point totals.
ALTER TABLE voucher_lines ADD COLUMN IF NOT EXISTS exact_math boolean DEFAULT false NOT NULL;
