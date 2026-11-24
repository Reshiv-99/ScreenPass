START TRANSACTION;

UPDATE Booking AS booking
JOIN `Show` AS screening ON screening.id = booking.showId
JOIN Screen AS screen ON screen.id = screening.screenId
JOIN Cinema AS cinema ON cinema.id = screen.cinemaId
SET booking.cinemaName = CONCAT('ScreenPass', SUBSTRING(booking.cinemaName, 10))
WHERE booking.cinemaName = cinema.name
  AND (cinema.name LIKE 'CineVault Demo Cinema · %' AND cinema.address LIKE '% · Simulated venue'
    OR cinema.name LIKE 'CineVault %' AND cinema.address LIKE '% City Centre · Demo venue');

UPDATE Cinema
SET name = CONCAT('ScreenPass', SUBSTRING(name, 10))
WHERE (name LIKE 'CineVault Demo Cinema · %' AND address LIKE '% · Simulated venue')
   OR (name LIKE 'CineVault %' AND address LIKE '% City Centre · Demo venue');

UPDATE User SET name = 'ScreenPass Admin'
WHERE name = 'CineVault Admin' AND role IN ('ADMIN', 'OWNER');

COMMIT;
