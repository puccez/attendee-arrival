import { Module } from "@nestjs/common";
import { CheckInController } from "./check-in/check-in.controller.js";
import { CheckInsService } from "./check-in/check-ins.service.js";
import { CLOCK, systemClock } from "./clock.js";
import { EventsService } from "./events/events.service.js";
import { InMemoryCheckInsStore, InMemoryEventsStore } from "./store/in-memory.js";
import { PgCheckInsStore, PgClient, PgEventsStore } from "./store/pg.js";
import { CHECK_INS_STORE, EVENTS_STORE } from "./store/store.js";

// Postgres quando l'ambiente lo fornisce (Vercel/Supabase),
// in-memory altrove (test, sviluppo locale senza database).
const pgUrl = process.env.POSTGRES_URL;
const pgClient = pgUrl ? new PgClient(pgUrl) : null;

@Module({
  controllers: [CheckInController],
  providers: [
    EventsService,
    CheckInsService,
    { provide: CLOCK, useValue: systemClock },
    {
      provide: EVENTS_STORE,
      useValue: pgClient ? new PgEventsStore(pgClient) : new InMemoryEventsStore(),
    },
    {
      provide: CHECK_INS_STORE,
      useValue: pgClient
        ? new PgCheckInsStore(pgClient)
        : new InMemoryCheckInsStore(),
    },
  ],
})
export class AppModule {}
