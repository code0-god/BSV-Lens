# Marketplace publishing

BSV Lens publishes `code0-god.bsv-lens` from `.github/workflows/publish.yml`.
Publishing is tag-only and consumes the exact VSIX produced by the reusable CI
workflow. No Personal Access Token is stored.

## Required identities

1. Create or select the Visual Studio Marketplace publisher `code0-god`.
2. Create a Microsoft Entra user-assigned managed identity for publishing.
3. Add a GitHub Actions federated credential to that identity:
   - issuer: `https://token.actions.githubusercontent.com`
   - audience: `api://AzureADTokenExchange`
   - subject: `repo:code0-god/BSV-Lens:environment:marketplace`
4. Add the managed identity to the Marketplace publisher with the Contributor
   role. Use its Azure DevOps profile resource ID, not its client ID.
5. Create a protected GitHub environment named `marketplace`.

The GitHub environment defines these non-secret variables:

- `AZURE_CLIENT_ID`: managed identity client ID
- `AZURE_TENANT_ID`: Entra tenant ID
- `AZURE_SUBSCRIPTION_ID`: Azure subscription ID

The publish job grants only `contents: read` and `id-token: write`. The OIDC
token authenticates `azure/login@v2`; `vsce publish --azure-credential` then
uses the federated Azure identity. Do not add `VSCE_PAT`.

## One-time Marketplace authorization

After federated Azure login, retrieve the identity's Azure DevOps profile:

```bash
az rest \
  --url https://app.vssps.visualstudio.com/_apis/profile/profiles/me \
  --resource 499b84ac-1321-427f-aa17-267ca6975798
```

Add the returned `id` to the publisher membership and grant Contributor.

## Release contract

1. Update `package.json.version`.
2. Run `npm run package` and all E2E checks locally.
3. Push reviewed commits through normal CI.
4. Create and push the exact tag `v<package.json.version>`.
5. The tag run calls reusable CI, downloads its verified artifact, checks the
   tag/version match, verifies archive CRCs and checksums, then publishes.

`vsce` rejects an existing Marketplace version. The workflow intentionally
does not use `--skip-duplicate`, so a duplicate tag cannot silently succeed.

## Tool compatibility

This repository pins `@vscode/vsce` 3.9.2 and uses
`--azure-credential`, which that release supports. Upstream `vsce` documents a
future direct `--oidc` mode, but it is not present in the pinned npm release.
Switch only after the installed CLI exposes that option and the workflow is
revalidated.

## Availability

`https://marketplace.visualstudio.com/items?itemName=code0-god.bsv-lens`
returned 404 on 2026-09-03. The first successful tag publish creates the
listing. Verify the public page before adding a Marketplace install badge.
