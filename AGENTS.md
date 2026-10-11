<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Rules

- Normalise database-view rows at the fetch site with `rowsWith` from `src/lib/rows.ts`, passing the fields that must always be present. PostgREST types every view column as nullable because it cannot see the NOT NULL guarantees behind a view, and per-use casts would hide genuinely missing values — rows without a required field are dropped instead.
