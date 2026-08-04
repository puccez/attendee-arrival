# Test del firmware che girano SENZA hardware: la parità fra la derivazione
# in C (quella che gira sull'ESP32) e @attendee-arrival/core (quella con cui
# il server verifica). Se divergono, il beacon emette codici che il server
# respinge — e non te ne accorgi finché non sei al venue.
#
#   make -C firmware test

ROOT := $(CURDIR)/..

.PHONY: test clean

test:
	pnpm --dir $(ROOT) --filter @attendee-arrival/core build
	node --test '$(CURDIR)/test/*.test.mjs'

clean:
	rm -rf $(CURDIR)/.pio
