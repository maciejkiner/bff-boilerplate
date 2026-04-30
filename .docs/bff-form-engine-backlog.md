# BFF Form & Workflow Engine — Backlog

> Specyfikacja zadań dla rozbudowy `bff-boilerplate` o pełny silnik formularzy i procesów.
> Każdy epic zawiera zadania posortowane od fundamentalnych do zaawansowanych.
> Oznaczenia: 🟢 rozbudowa istniejącego kodu | 🔵 nowy moduł od zera

---

## Epic 1 — Rozbudowa definicji pól 🟢

### 1.1 Refactor FormBuilder → FormDefinition
Zamiana fluent chain na obiektowy format definicji. Każde pole to obiekt z konfiguracją zamiast łańcucha metod. Wynikowy `FormDefinition` jest bogatym obiektem, który *między innymi* produkuje Zod schema — ale to nie jest jego jedyna rola.

### 1.2 System typów pól (FieldType registry)
Rejestr typów pól (`text`, `number`, `date`, `select`, `file`, `richtext`, `boolean`) z dedykowanymi opcjami konfiguracyjnymi per typ. Każdy typ pola definiuje: domyślny Zod validator, dozwolone opcje konfiguracji, typ wartości w TypeScript (generics).

### 1.3 Pola warunkowe — widoczność i wymagalność
Dodanie callbacków `visible` i `required` przyjmujących `FormContext`. Gdy pole jest niewidoczne, jest automatycznie pomijane w walidacji i usuwane z payloadu przed zapisem.

### 1.4 Grupy pól (FieldGroup)
Reużywalne bloki pól — np. `AddressGroup` (street, city, zip, country) definiowany raz, używany w wielu formularzach. Grupa ma własne namespace w values (`values.address.street`) i może mieć walidację grupową.

### 1.5 Repeatable sections (FieldArray)
Pola tablicowe — np. "dodaj kolejny kontakt". Definicja podzbioru pól, który użytkownik może powielać. Obsługa min/max ilości wpisów. Walidacja per wpis + walidacja całej tablicy.

### 1.6 Pola relacyjne (RelationField)
Select/multi-select ładowany dynamicznie z innej tabeli/modelu. Konfiguracja: model źródłowy, pole display, pole wartości, opcjonalny filtr. Integracja z `ModelBase` — automatyczny endpoint do ładowania opcji.

### 1.7 Computed fields
Pola wyliczane z wartości innych pól (readonly, nie zapisywane do bazy). Callback `compute: (values) => result`. Przeliczane przy każdej zmianie zależnych pól. Użyteczne do podsumowań, podglądów, automatycznych kalkulacji.

### 1.8 Wartości domyślne i inicjalizacja
System `defaultValue` per pole — statyczny lub jako callback z kontekstem (`(ctx) => ctx.user.department`). Wsparcie dla inicjalizacji formularza z częściowymi danymi (edit mode) z zachowaniem defaults dla brakujących pól.

---

## Epic 2 — Walidacja wielopoziomowa 🟢

### 2.1 Kontekst walidacji (ValidationContext)
Wprowadzenie enumu kontekstów walidacji: `draft`, `submit`, `approve`, `custom`. Każde pole może mieć różne reguły per kontekst — np. w draft nic nie jest required, w submit wszystko. `handleForm` przyjmuje kontekst jako parametr.

### 2.2 Cross-field validation
Warstwa walidacji powyżej per-field Zod — reguły operujące na wielu polach jednocześnie. API: tablica reguł `{ fields: ['startDate', 'endDate'], validate: (values) => ... }`. Błędy przypisywane do konkretnego pola lub do formularza globalnie.

### 2.3 Walidacja asynchroniczna
Mechanizm rejestrowania async validatorów (sprawdź w API, sprawdź w bazie). Rozdzielenie pipeline'u walidacji na: sync (Zod + cross-field) → async (external checks). Obsługa timeout i error handling dla async validators. Refactor istniejącego `isUnique` jako pierwszy async validator.

### 2.4 Walidacja grupowa
Walidacja na poziomie `FieldGroup` — np. blok "adres" musi być albo w całości pusty, albo w całości wypełniony. Walidacja `FieldArray` — np. min 1 wpis, unikalne wartości w tablicy.

### 2.5 Pluginowy system walidatorów
Mechanizm rejestrowania custom validatorów jako pluginów wielokrotnego użytku. Np. `validators.register('pesel', peselValidator)` — potem `field('pesel').validate('pesel')`. Biblioteka wbudowanych walidatorów: NIP, REGON, PESEL, IBAN, phone PL, itp. (opcjonalny pakiet).

### 2.6 Custom error messages i i18n
System klucz→wiadomość dla komunikatów walidacji. Domyślne komunikaty per typ reguły (required, maxLength, etc.). Możliwość nadpisania per pole. Wsparcie dla placeholderów w komunikatach (`"Maksymalnie {max} znaków"`). Hook do integracji z biblioteką i18n (zwracanie kluczy zamiast stringów).

---

## Epic 3 — Stany formularza (lifecycle) 🟢🔵

### 3.1 FormSubmission jako osobny byt
Nowy model `FormSubmission` z metadanymi: id, formName, status, data (JSONB), createdBy, createdAt, updatedAt, version. Oddzielenie "danych formularza" od "instancji wypełnienia". Migracja Drizzle dla tabeli `form_submissions`.

### 3.2 Status lifecycle — draft/submitted/locked
Enum statusów bazowych: `draft`, `submitted`, `locked`, `archived`. Logika przejść: draft pozwala na edycję z uproszczoną walidacją, submitted blokuje edycję użytkownika, locked jest readonly. Integracja z `handleForm` — zachowanie zależy od statusu.

### 3.3 Multi-step formularze (wizard)
Definicja kroków (steps) w `FormDefinition` — przypisanie pól do kroków. Walidacja per krok (nie cały formularz na raz). Endpoint do zapisu postępu per krok: `PATCH /submissions/:id/steps/:step`. Tracking aktualnego kroku w `FormSubmission`.

### 3.4 Autozapis (autosave drafts)
Mechanizm cyklicznego zapisu draftów bez pełnej walidacji. Debounced save na froncie → `PATCH /submissions/:id` z partial data. Merge strategia — partial update nie nadpisuje pól, których użytkownik nie tknął. Timestamp ostatniego autozapisu widoczny w UI.

### 3.5 Wersjonowanie danych (submission history)
Każdy save tworzy nową wersję w tabeli `form_submission_versions`. Przechowywanie: version number, data snapshot (JSONB), changedBy, changedAt. Endpoint do pobrania historii: `GET /submissions/:id/history`. Endpoint do pobrania konkretnej wersji: `GET /submissions/:id/history/:version`.

### 3.6 Soft delete i archiwizacja
Pole `deletedAt` na `FormSubmission`. Domyślne query pomija usunięte. Endpoint do archiwizacji (`POST /submissions/:id/archive`). Endpoint do przywracania (`POST /submissions/:id/restore`). Polityka retencji — konfigurowalny czas po którym archived → hard delete (opcjonalnie).

---

## Epic 4 — Workflow / State Machine 🔵

### 4.1 WorkflowDefinition — core state machine
Nowy moduł: definicja stanów i przejść w kodzie (code-first). API: `defineWorkflow({ states, transitions, initial })`. Każdy stan ma nazwę, typ (`initial`, `intermediate`, `final`), metadata. Każde przejście: `from → to`, nazwa akcji (np. `submit`, `approve`, `reject`).

### 4.2 Guards na przejściach
Warunki, które muszą być spełnione, żeby przejście się odbyło. API: `transition.guard((ctx) => ctx.user.role === 'manager')`. Guardy mogą być sync i async. Przy niespełnionym guardzie — zrozumiały komunikat błędu. Wiele guardów per przejście (AND logic).

### 4.3 Side effects (actions) na przejściach
Callback `onEnter` per stan i `onTransition` per przejście. Typy efektów: sync (update pola, zmień assigned), async (wyślij email, wywołaj webhook). Kolejność wykonania: guard → transition → onEnter nowego stanu. Error handling — co jeśli side effect failuje (retry? rollback?).

### 4.4 Powiązanie workflow z formularzem
Mechanizm bindowania `WorkflowDefinition` do `FormDefinition`. Formularz bez workflow = prosty CRUD (zachowanie wsteczne). Formularz z workflow = `FormSubmission` zyskuje pole `workflowState`. Endpointy do przejść: `POST /submissions/:id/transitions/:action`.

### 4.5 Assignees i ownership
Pole `assignedTo` na `FormSubmission`. Przejścia mogą automatycznie zmieniać assignee (np. submit → assigned to reviewer). Logika: kto jest potencjalnym assignee (rola, grupa, konkretny user). Endpoint do ręcznego reassign: `POST /submissions/:id/assign`.

### 4.6 Timeouty i eskalacje
Konfiguracja TTL per stan — np. "jeśli `under_review` dłużej niż 48h → auto-transition do `escalated`". Mechanizm scheduler (cron job / background worker) sprawdzający stale submissions. Notyfikacje przed timeout (reminder) i po (eskalacja).

### 4.7 Równoległe ścieżki (parallel branches)
Wsparcie dla stanów wymagających wielu niezależnych approval (np. manager AND legal). Tracking postępu per branch. Logika merge: all-must-approve vs any-must-approve. Stan złożony: `{ managerApproval: 'approved', legalApproval: 'pending' }`.

### 4.8 Workflow visualization (serialization)
Metoda `workflow.toGraph()` zwracająca strukturę stanów i przejść jako JSON. Endpoint: `GET /workflows/:name/graph`. Dane wystarczające do wyrenderowania diagramu na froncie (stany jako nodes, przejścia jako edges).

---

## Epic 5 — Uprawnienia powiązane z formularzem 🔵

### 5.1 FormContext — zunifikowany kontekst
Obiekt `FormContext<TValues, TUser>` dostępny we wszystkich callbackach (widoczność, walidacja, guardy). Zawiera: `values` (aktualne dane formularza), `user` (zalogowany użytkownik), `workflow` (aktualny stan, jeśli przypisany), `submission` (metadane instancji). Type-safe — TUser i TValues jako generics.

### 5.2 Uprawnienia per pole — visibility i editability
Każde pole zyskuje callbacki `visible(ctx)` i `editable(ctx)`. Różnica: `visible: false` = pole nie istnieje w odpowiedzi API. `editable: false` = pole widoczne, ale readonly, wartość ignorowana w payload. Domyślnie oba `true`.

### 5.3 Field-level redaction w API response
Serializer formularza filtruje pola na podstawie uprawnień użytkownika. Pola z `visible: false` dla danego usera — usuwane z JSON response. Pola z `editable: false` — oznaczone flagą `readonly: true` w schema response. Pola sensitive (np. salary) — osobna flaga `redacted` z zamaskowaną wartością.

### 5.4 Uprawnienia na przejściach workflow
Guardy na transition mogą sprawdzać rolę/uprawnienia usera. Wbudowany guard: `requireRole('manager')`, `requirePermission('approve_leave')`. Endpoint listing dostępnych przejść uwzględnia uprawnienia: `GET /submissions/:id/available-transitions` zwraca tylko te, które user może wykonać.

### 5.5 Delegowanie i zastępstwa
Mechanizm: user A deleguje uprawnienia userowi B na czas nieobecności. Delegacja scoped — do konkretnego workflow/formularza lub globalna. Delegacja widoczna w audit logu (akcja wykonana przez B "w imieniu" A). CRUD endpoints do zarządzania delegacjami.

---

## Epic 6 — Serializacja schematu na frontend 🟢

### 6.1 FormDefinition.toSchema() — bazowa serializacja
Metoda konwertująca definicję formularza do JSON Schema. Zawiera: listę pól z typami, etykietami, placeholderami, opcjami. Proste reguły (required, maxLength, options) serializowane 1:1. Output: `FormSchema` — typowany interfejs JSONa.

### 6.2 Endpoint GET /forms/:name/schema
Nowy endpoint w `ResourceRegistry` automatycznie rejestrowany dla każdego formularza. Odpowiedź uwzględnia uprawnienia (pola niewidoczne dla usera pominięte). Cache-friendly — ETag lub Last-Modified header.

### 6.3 Serializacja reguł warunkowych
Proste warunki (`visible when field X === value Y`) serializowane jako reguła deklaratywna w JSON: `{ "visible_when": { "field": "type", "eq": "sick" } }`. Złożone warunki (callbacki TS) — serializowane jako identyfikator reguły. Frontend wysyła request do BE po aktualny stan widoczności/wymagalności.

### 6.4 Serializacja multi-step (wizard metadata)
Schema zawiera informację o krokach: który krok, jakie pola, etykieta kroku. Frontend na tej podstawie renderuje wizard UI. Stan postępu (które kroki ukończone) osobno — z `FormSubmission`.

### 6.5 Schema diffing i migracja
Narzędzie porównujące dwie wersje schematu formularza. Wykrywanie: dodane/usunięte pola, zmienione typy, zmienione reguły. Raport kompatybilności: czy istniejące submissions są kompatybilne z nowym schematem. Helper do migracji danych: `migrateSubmissions(oldSchema, newSchema, transformer)`.

---

## Epic 7 — Rozbudowa CRUD / API layer 🟢

### 7.1 Filtrowanie i sortowanie
Generyczny mechanizm: query params → Drizzle `where` + `orderBy`. Filtry oparte o metadane z FormDefinition — dozwolone pola filtrujące wynikają z definicji. Operatory: `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `like`, `in`, `isNull`. Format query params: `?filter[status]=active&filter[createdAt][gte]=2025-01-01&sort=-createdAt`.

### 7.2 Paginacja
Dwa tryby: offset-based (`?page=2&pageSize=20`) i cursor-based (`?after=cursor123&limit=20`). Response envelope rozszerzony o metadane: `{ ok: true, data: [...], meta: { total, page, pageSize, hasNext } }`. Domyślny limit i max limit konfigurowalny per resource.

### 7.3 Lifecycle hooks
System hookowania do operacji CRUD: `beforeCreate`, `afterCreate`, `beforeUpdate`, `afterUpdate`, `beforeDelete`, `afterDelete`, `beforeList` (modyfikacja query). Hooki zdefiniowane w resource class jako metody (override) lub jako pluginy (rejestrowane). Hooki mają dostęp do pełnego kontekstu (request, user, dane).

### 7.4 Bulk operations
Endpoint `POST /resources/bulk` z tablicą operacji. Obsługa: batch create, batch update, batch delete. Transakcyjność — wszystko albo nic (opcjonalnie: partial success z raportem). Limit ilości operacji per request.

### 7.5 Nested resources
Mechanizm rejestrowania zasobów zagnieżdżonych: `registry.register('companies/:companyId/contacts', ContactsResource)`. Automatyczne filtrowanie po parent ID. Walidacja istnienia parenta. Zagnieżdżenie max 2 poziomy (konfigurowalny limit).

### 7.6 Partial update (PATCH)
Endpoint `PATCH /resource/:id` obok istniejącego `PUT`. Walidacja tylko przesłanych pól (nie whole-form validation). Merge z istniejącymi danymi. Ochrona przed nadpisaniem przez stale data (optimistic locking via version field).

### 7.7 Response shaping
Mechanizm wyboru pól w response: `?fields=id,name,email` (sparse fieldsets). Include relacji: `?include=contacts,address`. Exclude pól ciężkich: domyślnie pomijaj `description` w list, zwracaj w detail.

---

## Epic 8 — Audit log 🔵

### 8.1 Event model i storage
Tabela `audit_events`: id, entityType, entityId, action (create/update/delete/transition), userId, timestamp, payload (JSONB). Indeksy: entityType+entityId, userId, timestamp. Retencja — konfigurowalny TTL lub max records.

### 8.2 Automatyczne logowanie zmian CRUD
Integracja z lifecycle hooks (Epic 7.3). Każdy create/update/delete automatycznie tworzy audit event. Dla update — diff: stara wartość vs nowa wartość per pole (nie cały obiekt). Konfiguracja per resource — które pola logować (exclude sensitive).

### 8.3 Logowanie przejść workflow
Każda transition w workflow tworzy audit event. Payload: stary stan, nowy stan, akcja, kto wykonał, guardy które przeszły. Powiązanie z submission ID — pełna historia procesu.

### 8.4 API do odczytu audit logu
Endpoint: `GET /audit?entity=companies&entityId=123`. Filtrowanie: po entity, user, action, dacie. Paginacja (cursor-based — audit log może być duży). Opcjonalnie: endpoint per resource: `GET /companies/:id/audit`.

### 8.5 Audit log dla zmian uprawnień i delegacji
Logowanie: kto komu nadał/odebrał uprawnienie, kto stworzył delegację. Osobna kategoria eventów — security audit. Niemodyfikowalność — audit events nigdy nie są edytowane ani usuwane (append-only, soft delete wyłącznie dla retencji).

---

## Epic 9 — Testing utilities 🔵

### 9.1 FormTestKit — tworzenie test submissions
Helper: `FormTestKit.fill(userForm, { name: 'Jan', email: 'jan@test.pl' })`. Automatyczne uzupełnianie required pól sensownymi wartościami domyślnymi jeśli nie podane. Zwraca obiekt gotowy do assertions — values, errors, visibility. Builder pattern: `FormTestKit.fill(form).withContext({ user: mockAdmin }).validate('submit')`.

### 9.2 Asercje na walidację
API: `expect(result).toHaveError('email', 'required')`, `expect(result).toBeValid()`, `expect(result).toHaveNoErrors()`. Asercje na cross-field validation. Asercje na kontekst walidacji: `expect(result.inContext('draft')).toBeValid()`.

### 9.3 Asercje na widoczność i editability pól
API: `expect(form).withValues({ type: 'sick' }).toShowField('medicalCert')`. `expect(form).withUser(viewer).toHaveReadonly('salary')`. Testowanie pełnej matrycy widoczności — helper generujący tabelę pól × ról.

### 9.4 WorkflowTestKit — testowanie przejść
Helper: `WorkflowTestKit.start(leaveWorkflow).inState('submitted').as(manager).transition('approve')`. Asercje: `.toSucceed()`, `.toFail()`, `.toBeInState('approved')`. Testowanie guardów: `.transition('approve').toFailWithGuard('requireRole')`. Testowanie side effects: mock + asercja że side effect został wywołany.

### 9.5 Integration test helpers
Helper do stawiania testowej bazy (in-memory lub test container). Seed helpers: `seed.createUser({ role: 'manager' })`, `seed.createSubmission(form, { status: 'submitted' })`. Request helpers: `testClient.post('/users').withAuth(admin).send(payload)`. Cleanup: automatyczne czyszczenie po każdym teście.

### 9.6 Snapshot testing dla schematów
Helper do snapshot testowania serializowanego schematu formularza. Wykrywanie niezamierzonych zmian w schema (regresja). Integracja z Jest/Vitest: `expect(userForm.toSchema()).toMatchSnapshot()`. Snapshot workflow graph: `expect(leaveWorkflow.toGraph()).toMatchSnapshot()`.

---

## Sugerowana kolejność realizacji

```
Faza 1 — Fundament (Epic 1 + 2 + 7.1–7.3)
  Rozbudowa definicji pól, walidacja, lifecycle hooks w CRUD.
  To rozbudowuje istniejący kod bez łamania API.

Faza 2 — Submissions i stany (Epic 3 + 6)
  FormSubmission jako byt, draft/submit lifecycle, serializacja schematu.
  Daje multi-step i autozapis — wartość widoczna dla klienta.

Faza 3 — Workflow (Epic 4)
  State machine, guardy, side effects.
  Opcjonalny moduł — nie łamie prostych CRUD formularzy.

Faza 4 — Uprawnienia i audit (Epic 5 + 8)
  Per-field permissions, audit log.
  Buduje na workflow i hookach z wcześniejszych faz.

Faza 5 — DX i polish (Epic 9 + 7.4–7.7)
  Testing utilities, bulk ops, nested resources.
  Zwiększa adoption i wygodę pracy z biblioteką.
```
