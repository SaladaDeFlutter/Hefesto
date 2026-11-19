# Manifesto do winget

`SaladaDeFlutter.Hefesto.yaml` descreve o instalador NSIS para o
[repositório da Microsoft](https://github.com/microsoft/winget-pkgs). O instalador já traz Node.js e opencode.

## Publicar/atualizar

1. Gere o release `vX.Y.Z` (o workflow `.github/workflows/windows-release.yml` faz isso no push da tag).
2. Atualize `PackageVersion`, as URLs e os `InstallerSha256` neste arquivo (use os hashes do release).
3. Valide e envie (precisa do [wingetcreate](https://github.com/microsoft/winget-create)):

```cmd
winget install wingetcreate
wingetcreate validate packaging\winget\SaladaDeFlutter.Hefesto.yaml
wingetcreate submit --prtitle "New package: SaladaDeFlutter.Hefesto" packaging\winget\SaladaDeFlutter.Hefesto.yaml
```

Para versões seguintes, `wingetcreate update` também funciona:

```cmd
wingetcreate update SaladaDeFlutter.Hefesto --version X.Y.Z ^
  --urls https://github.com/SaladaDeFlutter/Hefesto/releases/download/vX.Y.Z/Hefesto-Setup-x64.exe ^
         https://github.com/SaladaDeFlutter/Hefesto/releases/download/vX.Y.Z/Hefesto-Setup-arm64.exe ^
  --submit
```

O instalador é `nullsoft` e aceita `/S` (silent), que é o que o winget usa.
