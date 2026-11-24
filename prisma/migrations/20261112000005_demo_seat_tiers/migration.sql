ALTER TABLE Seat MODIFY category ENUM('STANDARD', 'PREMIUM', 'RECLINER') NOT NULL;
ALTER TABLE ShowSeat MODIFY category ENUM('STANDARD', 'PREMIUM', 'RECLINER') NOT NULL;
ALTER TABLE BookingSeat MODIFY category ENUM('STANDARD', 'PREMIUM', 'RECLINER') NOT NULL;

START TRANSACTION;

CREATE TEMPORARY TABLE demo_tier_screens AS
SELECT screen.id
FROM Screen AS screen
JOIN Cinema AS cinema ON cinema.id = screen.cinemaId
JOIN City AS city ON city.slug = cinema.citySlug
WHERE (screen.name REGEXP '^Demo Auditorium [0-9]+$'
       AND cinema.name LIKE 'CineVault Demo Cinema · %'
       AND cinema.address = CONCAT(city.name, ' · Simulated venue'))
   OR (screen.name = 'Screen 1'
       AND cinema.name = CONCAT('CineVault ', city.name)
       AND cinema.address = CONCAT(city.name, ' City Centre · Demo venue'));

-- Extend the seeded seven-row auditoriums using their existing back-row numbering.
INSERT INTO Seat (id, screenId, `row`, number, category, enabled)
SELECT CONCAT('c', LEFT(REPLACE(UUID(), '-', ''), 24)), seat.screenId, 'H', seat.number, 'RECLINER', TRUE
FROM Seat AS seat
JOIN demo_tier_screens AS demo ON demo.id = seat.screenId
LEFT JOIN Seat AS recliner ON recliner.screenId = seat.screenId AND recliner.`row` = 'H'
WHERE seat.`row` = 'G' AND recliner.id IS NULL;

UPDATE Seat AS seat
JOIN demo_tier_screens AS demo ON demo.id = seat.screenId
SET seat.category = CASE
  WHEN seat.`row` = 'H' THEN 'RECLINER'
  WHEN seat.`row` IN ('E', 'F', 'G') THEN 'PREMIUM'
  ELSE 'STANDARD'
END;

-- Leave past shows, active payment holds and historical booking prices intact.
UPDATE ShowSeat AS inventory
JOIN `Show` AS screening ON screening.id = inventory.showId
JOIN Seat AS seat ON seat.id = inventory.seatId
JOIN demo_tier_screens AS demo ON demo.id = screening.screenId
SET inventory.category = seat.category,
    inventory.price = CASE seat.category WHEN 'RECLINER' THEN 750 WHEN 'PREMIUM' THEN 550 ELSE 350 END
WHERE screening.startsAt > UTC_TIMESTAMP(3)
  AND (inventory.holdId IS NULL OR inventory.holdUntil IS NULL OR inventory.holdUntil <= UTC_TIMESTAMP(3));

INSERT INTO ShowSeat (id, showId, seatId, price, category, enabled)
SELECT CONCAT('c', LEFT(REPLACE(UUID(), '-', ''), 24)), screening.id, seat.id, 750, 'RECLINER', seat.enabled
FROM `Show` AS screening
JOIN demo_tier_screens AS demo ON demo.id = screening.screenId
JOIN Seat AS seat ON seat.screenId = screening.screenId AND seat.`row` = 'H'
LEFT JOIN ShowSeat AS inventory ON inventory.showId = screening.id AND inventory.seatId = seat.id
WHERE screening.startsAt > UTC_TIMESTAMP(3) AND inventory.id IS NULL;

DROP TEMPORARY TABLE demo_tier_screens;
COMMIT;
