-- Rename the existing enum label in place: stored rows and dependent defaults keep their enum identity.
-- Unlisted records remain openable by direct link but are excluded from public listings.
alter type visibility rename value 'private' to 'unlisted';
