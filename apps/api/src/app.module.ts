import { Module } from "@nestjs/common";
import { CheckInController } from "./check-in/check-in.controller.js";
import { CheckInsService } from "./check-in/check-ins.service.js";
import { CLOCK, systemClock } from "./clock.js";
import { EventsService } from "./events/events.service.js";

@Module({
  controllers: [CheckInController],
  providers: [
    EventsService,
    CheckInsService,
    { provide: CLOCK, useValue: systemClock },
  ],
})
export class AppModule {}
