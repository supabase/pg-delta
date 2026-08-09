CREATE PUBLICATION corpus_subopt_pub FOR ALL TABLES;
-- Same subscription with every settable replication option flipped. Before
-- the option set was extracted these hashed identically to the a-state and
-- the diff was empty; now each must plan an in-place ALTER SUBSCRIPTION SET.
CREATE SUBSCRIPTION corpus_subopt
  CONNECTION 'host=localhost dbname=postgres'
  PUBLICATION corpus_subopt_pub
  WITH (
    connect = false,
    slot_name = NONE,
    enabled = false,
    binary = true,
    streaming = on,
    synchronous_commit = 'local',
    disable_on_error = true
  );
