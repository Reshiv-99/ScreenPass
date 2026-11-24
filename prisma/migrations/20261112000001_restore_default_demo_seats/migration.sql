-- Match the original fixture patterns on CineVault's own demo screens.
-- A changed layout or an auditorium with other disabled seats is left alone.
CREATE TEMPORARY TABLE default_disabled_seats (
  seat_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci PRIMARY KEY
);

INSERT INTO default_disabled_seats (seat_id)
SELECT seat.id
FROM Seat AS seat
JOIN Screen AS screen ON screen.id = seat.screenId
JOIN Cinema AS cinema ON cinema.id = screen.cinemaId
JOIN City AS city ON city.slug = cinema.citySlug
JOIN (
  SELECT screenId, COUNT(*) AS seat_count, SUM(enabled = FALSE) AS disabled_count,
    SUM(enabled = FALSE AND category = 'STANDARD' AND `row` = 'A' AND number IN (1, 10)) AS generated_edges,
    SUM(enabled = FALSE AND category = 'STANDARD' AND `row` = 'A' AND number IN (1, 12)) AS seeded_edges
  FROM Seat
  GROUP BY screenId
) AS layout ON layout.screenId = seat.screenId
WHERE seat.enabled = FALSE AND seat.`row` = 'A' AND layout.disabled_count = 2
  AND (
    (screen.name REGEXP '^Demo Auditorium [0-9]+$'
      AND cinema.address LIKE '% · Simulated venue'
      AND layout.seat_count = 80 AND layout.generated_edges = 2)
    OR
    (screen.name = 'Screen 1' AND cinema.name = CONCAT('CineVault ', city.name)
      AND cinema.address LIKE '% City Centre · Demo venue'
      AND layout.seat_count = 84 AND layout.seeded_edges = 2)
  );

START TRANSACTION;

UPDATE ShowSeat AS inventory
JOIN default_disabled_seats AS defaults ON defaults.seat_id = inventory.seatId
JOIN `Show` AS screening ON screening.id = inventory.showId
SET inventory.enabled = TRUE
WHERE inventory.bookingId IS NULL AND screening.startsAt > UTC_TIMESTAMP(3);

UPDATE Seat AS seat
JOIN default_disabled_seats AS defaults ON defaults.seat_id = seat.id
SET seat.enabled = TRUE;

COMMIT;

DROP TEMPORARY TABLE default_disabled_seats;
