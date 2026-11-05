import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { adminResourceKinds, type AdminAuditEntry, type AdminResource, type AdminResourceKind, type Page } from "@memegen/shared";
import { Button, Inline, Panel, SelectField, Spinner, Stack, Text, TextField } from "@memegen/ui";
import { deleteComment, deleteMeme, getTemplate, request } from "../api.ts";
import { useUser } from "../auth.tsx";
import { ErrorView, PagedList } from "../components/common.tsx";
import { TemplateAdminActions } from "../components/templateAdmin.tsx";
import { useAction } from "../useAction.ts";
import { useAsync } from "../useAsync.ts";
import { usePaged } from "../usePaged.ts";

export default function Admin() {
  const user = useUser();
  const [tab, setTab] = useState<"resources" | "audit">("resources");
  if (!user.isAdmin) return <ErrorView error={new Error("Administrator access required.")} />;
  return (
    <section className="admin-page" data-testid="admin-page">
      <h1>Administration</h1>
      <Inline>
        <Button data-testid="admin-resources-tab" aria-pressed={tab === "resources"} onClick={() => setTab("resources")}>Manage resources</Button>
        <Button data-testid="admin-audit-tab" aria-pressed={tab === "audit"} onClick={() => setTab("audit")}>Deletion audit</Button>
      </Inline>
      {tab === "resources" ? <Resources /> : <Audit />}
    </section>
  );
}

function Resources() {
  const [kind, setKind] = useState<AdminResourceKind>("memes");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("");
  const [filters, setFilters] = useState({ search: "", ownerId: "" });
  const [selected, setSelected] = useState<AdminResource | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const { busy, error, setError, run } = useAction();
  const list = usePaged<AdminResource>(JSON.stringify([kind, filters]), (offset) => {
    const query = new URLSearchParams({ search: filters.search, offset: String(offset), limit: "25" });
    if (filters.ownerId) query.set("ownerId", filters.ownerId);
    return request<Page<AdminResource>>(`/api/admin/resources/${kind}?${query}`);
  });
  function filter(e: FormEvent) {
    e.preventDefault();
    setFilters({ search: search.trim(), ownerId: owner.trim() });
    setSelected(null);
  }
  function choose(item: AdminResource) {
    setSelected(item);
    setConfirmation("");
    setNotice("");
    setError(null);
  }
  function remove() {
    if (!selected || confirmation !== selected.id) return;
    const target = selected;
    void run(async () => {
      if (target.kind === "memes") await deleteMeme(target.id);
      else if (target.kind === "comments") await deleteComment(target.id);
      else await request<void>(target.kind === "assets" ? `/storage/assets/${target.id}` : `/api/admin/${target.kind}/${target.id}`, { method: "DELETE" });
      setNotice(target.kind === "comments" ? "Comment removed. A placeholder remains while replies exist; clear replies before deleting its author." : `Deleted ${target.kind}: ${target.label}`);
      setSelected(null);
      list.reload();
    });
  }
  return (
    <Stack>
      <Panel heading="Content and accounts">
        <Text tone="muted">Browse all authors and visibility levels. Deletions cannot be undone. Audit records and internal configuration cannot be deleted here.</Text>
        <form className="admin-filters" onSubmit={filter}>
          <SelectField aria-label="Resource kind" data-testid="admin-kind" value={kind} onChange={(e) => { setKind(e.target.value as AdminResourceKind); setSelected(null); }}>
            {adminResourceKinds.map((value) => <option key={value} value={value}>{value}</option>)}
          </SelectField>
          <TextField aria-label="Search resources" data-testid="admin-search" placeholder="Name, text, ID, or owner name" value={search} onChange={(e) => setSearch(e.target.value)} />
          <TextField aria-label="Owner ID" data-testid="admin-owner-filter" placeholder="Owner UUID (optional)" value={owner} onChange={(e) => setOwner(e.target.value)} />
          <Button type="submit" data-testid="admin-filter">Search</Button>
        </form>
        <PagedList list={list} paging="button" moreTestId="admin-more" empty={<Text>No matching resources.</Text>}>
          {(items) => <ul className="admin-records">{items.map((item) => (
            <li key={item.id} data-testid="admin-resource" data-resource-id={item.id}>
              <div className="admin-record-info">
                {item.href ? <Link to={item.href}>{item.label}</Link> : <strong>{item.label}</strong>}
                <code>{item.id}</code>
                <Text size="sm" tone="muted">{item.ownerName ? `@${item.ownerName}` : "No owner"} · {new Date(item.createdAt).toLocaleString()}</Text>
              </div>
              <Inline>
                {item.ownerId && <Button size="sm" data-testid="admin-filter-owner" onClick={() => { setOwner(item.ownerId!); setFilters({ search: "", ownerId: item.ownerId! }); setSearch(""); setSelected(null); }}>Browse owner's resources</Button>}
                <Button variant="danger" size="sm" data-testid="admin-select-delete" disabled={busy} onClick={() => choose(item)}>Review deletion</Button>
              </Inline>
            </li>
          ))}</ul>}
        </PagedList>
      </Panel>
      {selected && <Panel heading={`Delete ${selected.kind}: ${selected.label}`} data-testid="admin-delete-review">
        <Text>Target: <code>{selected.id}</code></Text>
        {selected.kind === "templates" ? <TemplateReview id={selected.id} /> : <Stack>
          <Text>{selected.kind === "users" ? "Accounts with owned content cannot be deleted. Use Browse owner's resources, then switch resource kinds to clear blockers. Your own account, the last admin, and memegen are protected."
            : selected.kind === "assets" ? "Referenced assets cannot be deleted. Remove the referencing templates, memes, or stickers first. Metadata and audit commit before external bytes are removed; a storage cleanup failure will be reported explicitly."
              : selected.kind === "memes" ? "This also removes its comments, votes, and favorites. Stored assets remain."
                : selected.kind === "tags" ? "This removes the tag from templates and memes, not the content itself."
                  : selected.kind === "stickers" ? "This removes the library sticker. Its asset and existing image layers remain."
                    : "Comments with replies become placeholders. Delete replies first to remove the record entirely."}</Text>
          <TextField aria-label="Confirm target ID" data-testid="admin-confirm-id" placeholder="Type the target UUID to confirm" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
          <Button variant="danger" data-testid="admin-confirm-delete" disabled={busy || confirmation !== selected.id} onClick={remove}>Permanently delete this {selected.kind === "users" ? "account" : "resource"}</Button>
        </Stack>}
        <Button data-testid="admin-cancel-delete" disabled={busy} onClick={() => setSelected(null)}>Cancel</Button>
      </Panel>}
      {error !== null && <ErrorView error={error} testId="admin-delete-error" />}
      {notice && <Text role="status" data-testid="admin-delete-success">{notice}</Text>}
    </Stack>
  );
}

function TemplateReview({ id }: { id: string }) {
  const { data, error, setData } = useAsync(id, () => getTemplate(id));
  if (error !== null) return <ErrorView error={error} />;
  if (!data) return <Spinner />;
  return <TemplateAdminActions template={data} onChange={setData} />;
}

function Audit() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [kind, setKind] = useState("");
  const list = usePaged<AdminAuditEntry>(JSON.stringify([filter, kind]), (offset) => {
    const query = new URLSearchParams({ search: filter, offset: String(offset), limit: "25" });
    if (kind) query.set("kind", kind);
    return request<Page<AdminAuditEntry>>(`/api/admin/audit?${query}`);
  });
  return <Panel heading="Immutable deletion audit" data-testid="admin-audit">
    <Text tone="muted">Successful administrator deletions, including dependent records. Actor and target snapshots survive account removal. No edit or delete controls exist; database owners remain trusted and can alter database protections.</Text>
    <form className="admin-filters" onSubmit={(e) => { e.preventDefault(); setFilter(search.trim()); }}>
      <SelectField aria-label="Audit resource kind" data-testid="admin-audit-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="">All resource kinds</option>
        {adminResourceKinds.map((value) => <option key={value} value={value}>{value}</option>)}
      </SelectField>
      <TextField aria-label="Search audit" data-testid="admin-audit-search" placeholder="Label, actor, or target UUID" value={search} onChange={(e) => setSearch(e.target.value)} />
      <Button type="submit" data-testid="admin-audit-filter">Search audit</Button>
      <Button onClick={list.reload}>Refresh</Button>
    </form>
    <PagedList list={list} paging="button" moreTestId="admin-audit-more" empty={<Text>No matching deletions.</Text>}>
      {(items) => <ol className="admin-records">{items.map((entry) => <li key={entry.id} data-testid="admin-audit-entry" data-target-id={entry.targetId}>
        <div className="admin-record-info">
          <strong>{entry.action === "soft_delete" ? "Soft-deleted" : "Deleted"} {entry.targetKind}: {entry.label || "Untitled"}</strong>
          <Text>@{entry.actorName} · <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time></Text>
          <code>Target: {entry.targetId}</code><code>Actor: {entry.actorId}</code>
          <details><summary>Safe snapshot</summary><pre>{JSON.stringify(entry.snapshot, null, 2)}</pre></details>
        </div>
      </li>)}</ol>}
    </PagedList>
  </Panel>;
}
