## Dump and serialization

pg_dump order (schema only):

Core objects (essential for most databases) are marked with ✅

1. Extensions [ ]
2. Schemas [ ]
3. Collations
4. Conversions
5. Types (including enums, composite types) [ ]
6. Domains
7. Casts
8. Transforms
9. Sequences [ ]
10. Tables (without constraints/indexes) [ ]
11. Foreign Tables
12. Views [ ]
13. Materialized Views [ ]
14. Functions [ ]
15. Procedures [ ]
16. Operators
17. Operator Classes
18. Operator Families
19. Access Methods
20. Aggregates
21. Text Search Parsers
22. Text Search Templates
23. Text Search Dictionaries
24. Text Search Configurations
25. Foreign Data Wrappers
26. Foreign Servers
27. User Mappings
28. Default ACLs
29. Tablespaces
30. Constraints and Indexes [ ]
31. Statistics
32. Triggers
33. Event Triggers
34. ALTER ... OWNER TO statements (for all objects)
35. RLS Policies
36. Comments
37. Security Labels
38. Rules
39. Replication Origins
40. Publications
41. Publication Tables
42. Subscriptions
43. Subscription Tables