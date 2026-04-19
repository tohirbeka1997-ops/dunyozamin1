# GitHub Secrets & Variables — POS deploy

Quyidagi qiymatlarni **GitHub repo → Settings → Secrets and variables → Actions**
bo'limida to'ldirish kerak. Ikki turi bor:

- **Secrets** — parollar/SSH kalitlari; log'ga chiqmaydi.
- **Variables** — umumiy konfiguratsiya (masalan, domen); workflow-da ochiq ko'rinadi.

> Birinchi marta sozlaganingizda `vars.SKIP_DEPLOY=true` qilib qo'ying — shunda
> faqat Docker image build/push bo'ladi, SSH deploy bosqichi o'tkazib yuboriladi.
> Server tayyor bo'lgach, SKIP_DEPLOY ni olib tashlang yoki `false` ga o'zgartiring.

---

## Repository Secrets

| Nomi | Qayerda ishlatiladi | Izoh |
|------|--------------------|------|
| `DEPLOY_HOST`       | backend + frontend | Hetzner serveringizning IP yoki FQDN'i |
| `DEPLOY_USER`       | backend + frontend | SSH user (masalan `deploy`) |
| `DEPLOY_PORT`       | backend + frontend | Agar 22 bo'lmasa, raqam (masalan 2222) |
| `DEPLOY_SSH_KEY`    | backend + frontend | Privat SSH kalit (PEM format). Public qismi serverda `/home/deploy/.ssh/authorized_keys`'da bo'lishi kerak |
| `GHCR_USER`         | backend             | GitHub foydalanuvchi/org ham kifoya (image'ni GHCR'dan pull qilish uchun) |
| `GHCR_TOKEN`        | backend             | `read:packages` ruxsati bor GitHub PAT |

---

## Repository Variables

| Nomi | Izoh |
|------|------|
| `POS_DOMAIN`              | `pos.example.com` — health-check ishlatadi (`https://$POS_DOMAIN/health`). Bo'sh bo'lsa health step o'tkazib yuboriladi. |
| `VITE_POS_RPC_URL`        | Frontend ishlatadigan backend endpoint. Masalan `https://pos.example.com/api` |
| `VITE_PRINT_AGENT_URL`    | Kassa PC'dagi print agent manzili. Default: `http://127.0.0.1:17888` |
| `VITE_PRINT_AGENT_SECRET` | Print agent bearer secret (umumiy qilib biror kassaga bog'lab qo'ymang; har kassa PC'ga alohida generatsiya qilinadi va bu faqat misol) |
| `SKIP_DEPLOY`             | `true` bo'lsa backend SSH deploy step o'tkazib yuboriladi (bootstrap vaqtida foydali) |

> ⚠️ `VITE_POS_RPC_SECRET` ni **CI'da ATALY** qo'shmang. U `POS_HOST_SECRET` bilan
> bir xil bo'lib, faqat adminning bootstrap qilishi uchun. Oddiy foydalanuvchi
> sessiya tokeni orqali autentifikatsiya qiladi (login sahifasi).

---

## Environment: `production`

Backend va frontend deploy'lar GitHub *Environment* — `production` ga yo'naltirilgan.
Istasangiz:

1. **Settings → Environments → production** yarating.
2. **Required reviewers** ro'yxatiga bir nechta odam qo'shing — har deploy
   tasdiqdan o'tgandan keyingina boshlanadi.
3. Domainni `production.URL` ga ham yozib qo'ying (UI'da yorliq ko'rinadi).

---

## SSH kalitni generatsiya qilish (bir marta)

Lokal mashinada:

```bash
ssh-keygen -t ed25519 -f pos-deploy -C "github-actions@pos"
# Public qismni serverga:
ssh-copy-id -i pos-deploy.pub deploy@YOUR_HETZNER_IP
# Privat qismni (`pos-deploy` fayli ichidagi matn) DEPLOY_SSH_KEY secret qilib yuboring:
cat pos-deploy | gh secret set DEPLOY_SSH_KEY
# Keyin lokal nusxalarni xavfsiz tozalang:
shred -u pos-deploy pos-deploy.pub
```

## GHCR PAT

1. GitHub → **Settings → Developer settings → Personal access tokens → Tokens (classic)**.
2. Scope: `read:packages`, `write:packages` (agar CI ham push qilsa).
3. Hosil bo'lgan tokenni `GHCR_TOKEN` secretga joylang; egasining loginini `GHCR_USER` ga.

---

## Minimal bootstrap ketma-ketligi

```bash
# 1) Server bootstrap (root sifatida)
DEPLOY_USER=deploy \
POS_DOMAIN=pos.example.com \
GHCR_USER=YOUR_GH_USER \
GHCR_TOKEN=ghp_xxx \
bash deploy/scripts/server-bootstrap.sh

# 2) /opt/pos/.env — .env.server.example'dan ko'chiring + POS_HOST_SECRET to'ldiring
scp .env.server.example deploy@HOST:/opt/pos/.env
ssh deploy@HOST 'editor /opt/pos/.env'

# 3) Nginx + SSL
DOMAIN=pos.example.com EMAIL=admin@example.com \
  bash deploy/scripts/setup-nginx.sh

# 4) GitHub Secrets/Variables to'ldiring (yuqoridagi jadval)
# 5) main'ga push qiling → workflow deploy qiladi.
```
