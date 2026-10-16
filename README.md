# Vaultwarden Web Vault: Drag-and-Drop (DnD) Support

Репозиторий с наработками, патчами и пайплайном автоматической сборки кастомного веб-интерфейса Bitwarden / Vaultwarden с поддержкой перетаскивания (Drag-and-Drop) организационных записей между коллекциями.

---

## 🎯 Задача
В официальном веб-клиенте Bitwarden отсутствует удобный Drag-and-Drop для организационных паролей и записей между коллекциями/папками. Задача решена на уровне модификации фронтенда Angular без изменения бэкенда Vaultwarden.

---

## 🏗 Архитектура инфраструктуры

| Роль | Хост (пример) | Окружение | Назначение |
| :--- | :--- | :--- | :--- |
| **Сборочный узел** | `build-server` (Linux x86_64) | Node.js 24, Docker, >= 8 GB RAM | Сборка Angular (требует >4GB памяти) и сборка Docker-образа |
| **Прод-сервер** | `prod-server` | Docker, Traefik / Nginx, TLS | Хостинг работающего контейнера Vaultwarden |

---

## 📂 Структура репозитория

```
vaultwarden-web-dnd/
├── patches/
│   ├── 0001-vaultwarden-web-vault-dnd-upstream.patch # Git diff патч для наката на апстрим
│   └── REFERENCE.txt                                 # Инструкция по применению патча
├── src-modified/                                     # Чистые исходники измененных файлов
│   ├── vault-items/
│   │   └── vault-cipher-row.component.ts             # Обработчики dragstart/dragend, draggable=true
│   └── vault-filter/
│       ├── vault-filter-section.component.ts         # Логика drop-zone, dragover, перемещение ciphers
│       └── vault-filter-section.component.html       # Разметка зоны сброса коллекций
├── docker/
│   ├── Dockerfile                                    # Минимальный сборочный образ на базе vaultwarden/server
│   └── docker-compose.prod.yml                       # Пример compose-файла с Traefik
└── scripts/
    └── build-and-deploy.sh                           # Сквозной скрипт сборки, упаковки, передачи и деплоя
```

---

## 🧩 Ключевые изменения в коде

1. **`vault-cipher-row.component.ts`**:
   - Навешан селектор хоста: `[attr.draggable]="!disabled && !decryptionFailure && !isDeleted"`
   - Добавлены эмиттеры `dragstart` / `dragend` для передачи объекта `cipher` в контекст глобального drag-события.
2. **`vault-filter-section.component.ts`**:
   - Реализована обработка зон падения `(dragover)` и `(dragleave)` с визуальной подсветкой активной коллекции.
   - Метод `onDropCollection()`: парсит ID перетаскиваемой записи, валидирует права и вызывает API обновления коллекций записи в шифрованном хранилище.

---

## ⚙️ Пошаговый пайплайн сборки и деплоя

Выполняется через скрипт `scripts/build-and-deploy.sh`:

```bash
# Переменные можно переопределить перед запуском:
export BUILD_HOST="user@build-server"
export PROD_HOST="user@prod-server"
export BUILD_HOST_IP="10.x.x.x"
export VAULT_DOMAIN="vault.example.com"

./scripts/build-and-deploy.sh
```

### Детали шагов:
1. **Сборка Angular на сборочном узле**:
   ```bash
   cd /path/to/web-vault/apps/web
   NODE_OPTIONS='--max-old-space-size=8192' npm run dist:oss:selfhost
   ```
2. **Упаковка в Docker**:
   ```dockerfile
   FROM vaultwarden/server:1.37.3
   COPY web-vault-custom /web-vault
   ```
   Сборка с обязательным флагом `--no-cache`, чтобы исключить залипание старых слоёв.
3. **Передача через временный HTTP-мост**:
   Образ экспортируется через `docker save | gzip`, передается на целевой сервер и загружается через `docker load`.
4. **Перезапуск контейнера на проде**:
   ```bash
   docker compose down && docker compose up -d
   ```
   *(Используется полная цепочка down/up, так как `restart` не пересоздает слои томов)*.

---

## 🔍 Проверка работоспособности (Smoke Test)

```bash
# 1. Проверка версии бандла на сервере
curl -sL https://vault.example.com/ | grep -oE 'main\.[^.]+\.js'

# 2. Проверка наличия DnD-директив в живом бандле
curl -sL "https://vault.example.com/app/$(curl -sL https://vault.example.com/ | grep -oE 'main\.[^.]+\.js' | head -1)" | grep -c 'appVaultCipherRow'
```
Ожидаемый результат: HTTP 200 и число вхождений > 0.
