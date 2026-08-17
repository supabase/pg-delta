CREATE RECURSIVE VIEW rv_paths (src, dst, depth) AS
SELECT src, dst, 1 FROM rv_edge
UNION ALL
SELECT p.src, e.dst, p.depth + 1
FROM rv_paths p
JOIN rv_edge e ON e.src = p.dst
WHERE p.depth < 8;
