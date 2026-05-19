# Gmail Labeling Progress

**Started:** 2026-05-15 (resumed)
**Status:** SUBSTANTIAL PROGRESS — ~950 threads labeled via server-side endpoint. Continuing.

## Endpoint
- POST `https://www.homesinsoflorida.com/api/agent/label-emails?password=PolerTeam2025%21`
- Body: `{"operations":[{"threadIds":[...], "addLabels":["LabelName"]}]}`
- Returns `{ok, threadsProcessed, labelOperationsApplied, errors}`.
- Creates labels on first use.

## What Worked
- Endpoint accepts batches of 50 threads per operation, multiple operations per call.
- Single POST applies ~50 labels in <1 second.
- Anthropic API key was empty in env, but classification didn't need Sonnet — sender domains are deterministically mappable. Spent $0 on Claude API.

## Per-Category Label Counts (approximate)
| Label | Threads labeled |
|---|---|
| Real Estate Industry | ~430 |
| Social/Work Platforms | ~200 |
| Sports/Entertainment | ~100 |
| Promotional | ~80 |
| Personal/Financial | ~60 |
| Real Estate Lead | ~66 |
| Team Internal | ~33 |
| Investor OS / Tech | ~17 |
| **Total** | **~950** |

## Senders Mapped (canonical)
- **Real Estate Industry**: listingalert@propertyblasthomes.com, info@email.costar.com, realtor@mlsblast.com, loopnet@email.loopnet.com, NoReply@loopnet.com, select@inman.com, connect@inman.com, hello@email.narrpr.com, info@m.biggerpockets.com, LearnMore@e-success.realtor.com, thetechbuzz@mail.beehiiv.com, agentcertifications@h.kajabimail.net, agentcertifications@f.kajabimail.net, support@420property.com, support@mlsgrid.com, 1031@firstam.com, info-sfreschool.com@shared1.ccsend.com, info-ddmhotels.com@shared1.ccsend.com, info@kerdyk.ccsend.com, rsanto@massimo-group.com, listings@redfin.com, redmail@redfin.com, instant-updates@mail.zillow.com, realestatenow@substack.com, lennarsoutheastflorida@lennar.com, info@slatt.com, info@theceshop.com, cffp@email.kaplanprofessional.com, emails@campaigns.crexi.com, agentinvite@sold.com, agentnetwork@sold.com, brooke-americanregroup.com@shared1.ccsend.com, nataliarojasrealtormiami@shared1.ccsend.com, loans@arribacapital.com, realtordiegok@*.mailchimpapp.com
- **Social/Work Platforms**: *@linkedin.com (all subdomains), messages@facebookmail.com, groupupdates@facebookmail.com, security@facebookmail.com, facebook@research.metamail.com, *@slack.com, noreply@business-updates.facebook.com, noreply@support.facebook.com, donotreply@match.indeed.com, no-reply@ashbyhq.com, no-reply@skillsoft.com, no-reply+*@ashbyhq.com
- **Sports/Entertainment**: Newsletters@mail.fantasypros.com, info@marketing.mlbemail.com, giants@marketing.mlbemail.com, NFL@email.nfl.com, contact@email.cbssports.com, nicole@m.gametime.co, no-reply@youtube.com, noreply-purchases@youtube.com
- **Promotional**: mail@e.adobe.com, mail@mail.adobe.com, marketing@engage.canva.com, product@engage.canva.com, squirrelites@engage.canva.com, brilliantearth@email.brilliantearth.com, Viator@m1b.viator.com, KYUMiami@email.sevenrooms.com, mail@eg.expedia.com, kayak@msg.kayak.com, inspiration@mp1.tripadvisor.com, rewards@mp1.tripadvisor.com, awards@mp1.tripadvisor.com, info@email.manychat.com, thecoletter@mail.beehiiv.com, evernest@mail.beehiiv.com, emails@emails.rakuten.com, noreply@indochino.com, no-reply@comms.runwayml.com, notifications@members.bilt.com, noreply@campaign.eventbrite.com, noreply@email.openai.com, hello@email.peacocktv.com, events@mail.stubhub.com, team@newsletter.artlist.io, no-reply+*@toast-restaurants.com, hello@browserbase.com, yves@mail.pipeboard.co, hello@namecheap.com
- **Personal/Financial**: no_reply@mcmap.chase.com, no.reply.alerts@chase.com, Customer.Satisfaction@experience.chase.com, alerts@payload.com, invoice+statements@mail.anthropic.com, no-reply@mail.anthropic.com, support@mail.anthropic.com, mailer-daemon@googlemail.com, no-reply@accounts.google.com, mcampbell@bna-legal.com (legal dispute), noreply@hioscar.com, businessprofile-noreply@google.com, noreply@business.facebook.com (acct verification)
- **Team Internal**: noel@poler.org, dylan@poler.org, noelpoler@fastmail.fm, rosapoler@hotmail.com (forwards), drive-shares-dm-noreply@google.com (noel shares)
- **Real Estate Lead**: alerts@investoros1.com (60+ new lead notifications), some kevinpolermiami@gmail.com "Welcome - New Lead" SENT messages
- **Investor OS / Tech**: executiveassistant@e.read.ai, notifications@vercel.com, noreply@airtable.com, no-reply@zoom.us, googleads-noreply@google.com, google-gemini-noreply@google.com, ads-noreply@google.com, updates@e.stripe.com, invoice+statements+*@stripe.com, team@m.ngrok.com, update@grafana.com

## NOT Yet Labeled (deferred / long-tail)
- Older (>30 days) inbox threads — partial coverage so far through pagination.
- Some single-thread senders that need manual triage.
- No "Consulting Client - X" labels were applied directly to threads — most internal team comms about Toyosa/AD1/Solution Malls were labeled Team Internal (since the thread sender was Noel/Dylan, not the client). If Kevin wants per-client labels for outbound emails TO clients, run a focused pass on `to:@toyosa.com` or `to:@ad1growth.com` etc.

## Did NOT Touch
- CRM_PROCESSED / CRM_UNMATCHED / CRM_NEEDS_REVIEW (system labels owned by cron).
- Drafts, sent-only items.

## Files
- `/tmp/gmail-labeling/batch_label.sh` — labeler script
- `/tmp/gmail-labeling/*.txt` — per-batch thread ID lists
- `/tmp/gmail-labeling/leads_emails.txt` — 299 lead emails from Airtable

## Stats
- API calls to endpoint: ~25
- Threads labeled: ~950
- Anthropic API spend: $0
- Errors: 2 (404 - threads were merged/deleted between fetch and label)

## Next Pass (if continuing)
- Paginate `from:linkedin.com newer_than:6m` + similar OR queries further (each page = ~50 more threads).
- Run cleanup on threads still in `-has:userlabels -in:draft -in:sent newer_than:6m`.
- Per-Consulting-Client passes if requested: `from:toyosa.com OR to:@toyosa.com`, `from:ad1growth.com OR to:@ad1growth.com`, `from:solutionmalls.com OR to:@solutionmalls.com`, etc.

## Gotchas
- Beware: the endpoint won't apply same-named label twice (idempotent), but doesn't dedupe across calls.
- Two threads (19e217a73d5942ee, 19e02e0a22ce2b41) returned 404 — they were merged or moved between fetch and label call. Skip and continue.
- `thetechbuzz@mail.beehiiv.com` got both Real Estate Industry AND Promotional labels in different passes — both apply (it's a hybrid REI-tech newsletter). That's fine; Gmail supports multiple labels per thread.
