-- Run on the TARGET db first. Every row must read OK, else DO NOT apply the patch.
SELECT 'submissions max id (expect 128)' AS chk, MAX(id) AS val, CASE WHEN MAX(id)=128  THEN 'OK' ELSE 'DRIFT-ABORT' END AS status FROM submissions
UNION ALL SELECT 'species_name_group max (expect 2389)', MAX(group_id), CASE WHEN MAX(group_id)=2389 THEN 'OK' ELSE 'DRIFT-ABORT' END FROM species_name_group
UNION ALL SELECT 'common_name max (expect 7025)', MAX(common_name_id), CASE WHEN MAX(common_name_id)=7025 THEN 'OK' ELSE 'DRIFT-ABORT' END FROM species_common_name
UNION ALL SELECT 'scientific_name max (expect 2345)', MAX(scientific_name_id), CASE WHEN MAX(scientific_name_id)=2345 THEN 'OK' ELSE 'DRIFT-ABORT' END FROM species_scientific_name
UNION ALL SELECT 'Steve submissions (expect 12)', COUNT(*), CASE WHEN COUNT(*)=12 THEN 'OK' ELSE 'DRIFT-ABORT' END FROM submissions WHERE member_id=13
UNION ALL SELECT 'migrations applied (expect 51)', COUNT(*), CASE WHEN COUNT(*)=51 THEN 'OK' ELSE 'CHECK-ORDER' END FROM migrations;
