ALTER TABLE sr_nodes
  ADD CONSTRAINT sr_nodes_parent_fk
  FOREIGN KEY (parent_id) REFERENCES sr_nodes (id);
