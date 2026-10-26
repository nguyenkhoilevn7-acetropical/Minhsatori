CREATE TABLE IF NOT EXISTS satori_v2_gemini_budget (
 day date NOT NULL,
 bucket text NOT NULL,
 calls integer NOT NULL CHECK(calls>0),
 PRIMARY KEY(day,bucket)
);
