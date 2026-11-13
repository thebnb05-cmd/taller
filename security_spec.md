# Security Specification — TH3 BNB Servicio Técnico (Firestore)

## 1. Data Invariants
1. Every private workshop document (`workshopProfiles`, `clients`, `repairs`, `products`, `tasks`, `suppliers`, `sales`, `purchases`) must contain an immutable `ownerId` matching `request.auth.uid` with `request.auth.token.email_verified == true`.
2. Every `workshopProfiles/{profileId}` document ID must equal `request.auth.uid`.
3. `createdAt` is immutable and must equal `request.time` on document creation. `updatedAt` must equal `request.time` on creation and update.
4. `list` queries on private collections enforce `resource.data.ownerId == request.auth.uid` at the rule level (never delegated to client filtering).
5. `publicTickets/{trackingCode}` contains zero PII (no client name, phone, DNI, email, address, PIN, or pattern), disallows `list` completely (`allow list: if false;`), and allows `get` only with a validated `trackingCode` ID.
6. All document IDs match `^[a-zA-Z0-9_\-]+$` with `size() <= 128`, and every string and list enforces explicit upper size limits.

## 2. Adversarial "Dirty Dozen" Payloads (Must Return PERMISSION_DENIED)
1. **Unauthenticated read/write**: Read `/clients/c1` without `request.auth` -> DENIED.
2. **Unverified email write**: Create `/clients/c1` with `email_verified == false` -> DENIED.
3. **Cross-tenant owner spoofing**: User A creates `/repairs/r1` with `ownerId: "user_B"` -> DENIED.
4. **Cross-tenant list scraping**: User A lists `/clients` without matching `ownerId == userA` -> DENIED.
5. **Shadow / Ghost field injection**: Create `/clients/c1` with extra `isAdmin: true` -> DENIED (`keys().hasOnly(...)`).
6. **Update shadow field**: Update `/repairs/r1` adding `ghostFlag: 1` -> DENIED (`affectedKeys().hasOnly(...)`).
7. **Immutable ownerId hijack**: Update `/products/p1` changing `ownerId` -> DENIED.
8. **Immutable createdAt tampering**: Update `/repairs/r1` modifying `createdAt` -> DENIED.
9. **Client-spoofed timestamp**: Create `/tasks/t1` with `createdAt: 1700000000` instead of `request.time` -> DENIED.
10. **Public ticket scraping**: Call `list` on `/publicTickets` -> DENIED (`allow list: if false`).
11. **ID poisoning**: Create `/clients/invalid$id!with*spaces` -> DENIED (`isValidId`).
12. **Resource exhaustion / oversized payload**: Create `/repairs/r1` with `problem` string > 2000 chars or `accessories` array > 30 items -> DENIED.
