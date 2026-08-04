# Espansioni future

## Testimonianza tra pari (BLE reciproco tra partecipanti)

**Cosa:** ogni telefono di un partecipante rileva via BLE i token rotanti degli altri partecipanti presenti e riporta al server gli incontri (peer visto, intervallo, RSSI mediano, numero di campioni). Le presenze si corroborano a vicenda: "Alice ha visto Luca, Luca ha visto Alice" vale molto più di due prove indipendenti.

**Cosa aggiunge al modello del testimone:**
- Rafforza i check-in di gruppo: il gruppo emerge dagli incontri reciproci, senza flussi dedicati.
- Alza il costo dell'attacco col complice singolo: gli amici remoti che ricevono i codici inoltrati non risultano visti da nessun altro partecipante — l'assenza di incontri reciproci è di per sé un segnale.
- Aggiunge ridondanza al notaio: se il beacon dell'host muore a metà evento, la rete di incontri tra pari continua a produrre evidenza di co-presenza.

**Precedente citabile:** è lo schema delle Exposure Notifications Apple/Google (token BLE rotanti, RSSI, durata degli incontri), provato su scala planetaria. Nella tassonomia dello stato dell'arte (pipeline Zenly/Bump) è la "conferma da altri dispositivi": ogni telefono diventa testimone degli altri.

**Perché non ora:** aumenta la superficie privacy (i partecipanti si tracciano a vicenda: servono consenso esplicito, minimizzazione e retention dedicate) e la complessità client (advertising + scanning simultanei su entrambe le piattaforme, con i limiti background di iOS). Sproporzionato per la prima versione; sensato quando il sistema base è a regime.

**Asset esistente:** il pattern è già implementato nello stack ProxiMate (`IBeaconManager`: advertising + scanning simultanei, heartbeat GATT tra peer, timestamp di sessione sincronizzati). L'espansione è un adattamento, non una costruzione da zero.
