# Pitch numbers (all from out/, quick estimates)

1. **55,215 bus transfers/day = 26.0% of 212,161 Metro exits/day** - hotspots.json: sum of station transfers_per_day / sum of exits_per_day (3-6 Mar average).
2. **Central: 4,762/day (32.4% of exits)** - hotspots.json; extra boardings at nearby stops in the 25 min after a train pulse, minus the false-echo rate at control stops.
3. **Thirumangalam: 4,112/day (43.2%)** - same method, hotspots.json.
4. **Guindy: 3,925/day (44.3%)** - same method, hotspots.json. (Thirumangalam and Guindy are above 40%; read as indicative.)
5. **Top stop shares: Guindy TVK Estate 17.5% of exits, Central MGRCENTRAL 27.4%** - flows.json: stop-level echo / station exits.
6. **Worst-wait station: Alandur, 12.8 min average** - hotspots.json totals.worst_wait_station; pulse-weighted wait from pulse + walk to next bus. Only ~204 transfers/day and thin bus data, so weak.
7. **15 extra buses across 15 routes** - recommendations.json summary: extra buses to bring the target headway to max(8 min, 0.6 x current).
8. **5,842 passenger-minutes saved/day** - recommendations.json summary: transfers x (wait before - wait after), simulated against real pulse times.
9. **Top 3 regular flows (all Thousand Lights): 2,022 cards 09:30-10:00 on route 25 to Anna Square; 1,761 cards 09:00-09:30 on route 25 to Anna Square; 1,036 cards 10:00-10:30 on route 13 to Rajiv Gandhi Govt Hospital** - regulars.json: cards exiting within +-20 min of their own median on 3+ of 4 days. Caveat: Thousand Lights counts look high.
10. **Before vs after placebo: 179,304 -> 55,216 transfers/day** - method.json validation: raw echo vs echo after subtracting the control-stop rate (avg 0.239) and applying the 50%/35% caps.
