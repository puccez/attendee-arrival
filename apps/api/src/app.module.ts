import { Module } from "@nestjs/common";
import { CheckInController } from "./check-in/check-in.controller.js";
import { CheckInsService } from "./check-in/check-ins.service.js";
import { CLOCK, systemClock } from "./clock.js";
import { EventsService } from "./events/events.service.js";
import { NotaryDevicesService } from "./notary/notary-devices.service.js";
import { LazyCheckInsStore, LazyEventsStore } from "./store/lazy.js";
import { CHECK_INS_STORE, EVENTS_STORE } from "./store/store.js";

@Module({
  controllers: [CheckInController],
  providers: [
    EventsService,
    CheckInsService,
    NotaryDevicesService,
    { provide: CLOCK, useValue: systemClock },
    { provide: EVENTS_STORE, useValue: new LazyEventsStore() },
    { provide: CHECK_INS_STORE, useValue: new LazyCheckInsStore() },
  ],
})
export class AppModule {}
