-- Retire relay transport without changing family records or audit history.
DROP INDEX IF EXISTS google_tasks_command_intent;
DROP INDEX IF EXISTS google_tasks_command_state;
DROP TABLE IF EXISTS google_tasks_transition_guard;
DROP TABLE IF EXISTS google_tasks_commands;
DROP TABLE IF EXISTS google_tasks_mirror;
DROP TABLE IF EXISTS google_tasks_generation;
