import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { CHECK_LABEL, KIND_LABEL } from "@/components/watchtower";

export const Route = createFileRoute("/_authenticated/targets/new")({
  head: () => ({
    meta: [
      { title: "Nieuw target — Nomadix Watchtower" },
      { name: "description", content: "Voeg een nieuwe property toe aan de monitoring." },
      { property: "og:title", content: "Nieuw target — Nomadix Watchtower" },
      {
        property: "og:description",
        content: "Voeg een nieuwe property toe aan de monitoring.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NewTargetPage,
});

function NewTargetPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("storefront");
  const [url, setUrl] = useState("");
  const [frequency, setFrequency] = useState("daily");
  const [enabled, setEnabled] = useState(true);
  const [checks, setChecks] = useState<Record<string, boolean>>({
    http: true,
    ssl: true,
    dns: false,
    form_smoke: false,
  });
  const [formSmokeUrl, setFormSmokeUrl] = useState("");
  const [notes, setNotes] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("watch_targets")
        .insert({
          name: name.trim(),
          kind,
          url: url.trim(),
          frequency,
          enabled,
          checks,
          form_smoke_url: checks.form_smoke && formSmokeUrl.trim() ? formSmokeUrl.trim() : null,
          notes: notes.trim() || null,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["watch_targets"] });
      toast.success("Target toegevoegd");
      navigate({ to: "/target/$id", params: { id: data.id } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell>
      <div className="max-w-2xl space-y-6">
        <h1 className="text-lg font-semibold tracking-tight">Nieuw target</h1>

        <form
          className="panel fade-in-card space-y-5 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !url.trim()) {
              toast.error("Naam en URL zijn verplicht");
              return;
            }
            create.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="name">Naam</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Soort</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND_LABEL).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Frequentie</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Dagelijks</SelectItem>
                  <SelectItem value="weekly">Wekelijks</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="url">URL</Label>
            <Input
              id="url"
              type="url"
              placeholder="https://voorbeeld.be"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </div>

          <div className="space-y-3">
            <Label>Checks</Label>
            {Object.keys(CHECK_LABEL).map((key) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">{CHECK_LABEL[key]}</span>
                <Switch
                  checked={!!checks[key]}
                  onCheckedChange={(v) => setChecks((c) => ({ ...c, [key]: v }))}
                />
              </div>
            ))}
          </div>

          {checks.form_smoke && (
            <div className="space-y-2">
              <Label htmlFor="smoke">Formulier smoke-URL</Label>
              <Input
                id="smoke"
                type="url"
                value={formSmokeUrl}
                onChange={(e) => setFormSmokeUrl(e.target.value)}
              />
            </div>
          )}

          <div className="flex items-center justify-between">
            <Label htmlFor="enabled">Actief</Label>
            <Switch id="enabled" checked={enabled} onCheckedChange={setEnabled} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notities</Label>
            <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>

          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? "Bezig…" : "Target toevoegen"}
          </Button>
        </form>
      </div>
    </AppShell>
  );
}
