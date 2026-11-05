-- Privileges are provisioned explicitly in the database, never through public session input.
alter table users add column is_admin boolean not null default false;
