-- usahaku now has one role. Old Staff and Accountant accounts stop working; their rows stay.
DELETE FROM sessions
WHERE user_id IN (SELECT id FROM users WHERE role <> 'owner');

UPDATE users
SET is_active = false, updated_at = now()
WHERE role <> 'owner';
