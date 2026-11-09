CREATE TABLE schedule_cells (
  day INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  note TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (day, slot)
);
