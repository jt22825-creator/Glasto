# Glasto Ticket Day Helper

A userscript for the Glastonbury 2027 ticket sales:

- **Coach sale:** Thu 1 Oct, 6pm
- **General sale:** Sun 4 Oct, 9am

It never sends requests to See Tickets and never fills in or submits forms. It only watches the tab you opened yourself.

## What it does
- **Alarm when you're through.** When the queue page turns into the booking page, it plays an alarm, flashes the tab title and shows a desktop notification.
- **Group push notification (optional).** It can send a notification to everyone's phones through [ntfy.sh](https://ntfy.sh), so the group knows who got through.
- **Refresh guard.** While you're in the queue it blocks F5 and Ctrl/Cmd+R, because refreshing sends you to the back.
- **Group details.** Each person's registration number and postcode gets a copy button for the 10-minute checkout.
- **Countdown.** It counts down to the next sale and warns you 5 minutes before to stay on the page.
- **Blocked-page warning.** It alerts you if the page shows "access denied".

## Setup
1. Install [Tampermonkey](https://www.tampermonkey.net/) or Violentmonkey.
2. Create a new script and paste in `glasto-helper.user.js`.
3. Open `glastonbury.seetickets.com`. Under **Setup**, enter your group, one person per line with the lead booker first: `Name, RegNumber, Postcode`. Click **Save**.
4. Optional: everyone installs the ntfy app, subscribes to the same hard-to-guess topic and enters it in Setup. Test it with **Send test push**.
5. Click **Test alarm** once. Browsers only play sound after you've clicked on the page.

## Ticket-day plan
- **Everyone registered.** Check every registration number is still valid.
- **Be on the page before the start time.** Everyone on the page at that moment is put into the queue in random order. Anyone who arrives later goes to the back.
- **One device per IP address.** Your laptop on home broadband counts as one. Each phone on mobile data with Wi-Fi off counts as another.
- **Spread out.** Friends in other households each queue on their own connections. Whoever gets through first books for everyone, up to 6 people.
- **Don't refresh once you're in the queue.**
- **Have payment ready.** Keep a card that can take £100 × the number of people.
- **Try both sales.** The coach sale on Thursday is an extra round of chances.

## Caveat
The script works out whether you're in the queue or on the booking page by matching the page's text. Those patterns are guesses based on past sales. Check that it says "In the queue" once you join. If it doesn't, keep an eye on the tab yourself.

---

## Also in this repo
- [`name-royale/`](name-royale/): **Name Royale**, a "chat plays" battle royale game for YouTube live streams. See its README.
