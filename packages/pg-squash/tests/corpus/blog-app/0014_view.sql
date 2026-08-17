CREATE VIEW blog.post_stats AS
SELECT p.id,
       p.slug,
       (SELECT count(*) FROM blog.comments c WHERE c.post_id = p.id) AS comments,
       (SELECT count(*) FROM blog.likes l WHERE l.post_id = p.id) AS likes
FROM blog.posts p;
