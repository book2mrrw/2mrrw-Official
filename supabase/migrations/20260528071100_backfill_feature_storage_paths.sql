-- Backfill storage_path for feature products that were seeded without it
UPDATE products
SET storage_path = 'digital-assets/singles/i-dont-believe-you/audio.wav'
WHERE slug = 'i-dont-believe-you' AND (storage_path IS NULL OR storage_path = '');

UPDATE products
SET storage_path = 'digital-assets/singles/2-heavy/audio.wav'
WHERE slug = '2-heavy' AND (storage_path IS NULL OR storage_path = '');
