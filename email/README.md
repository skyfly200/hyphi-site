# Hyphi email template

`newsletter.html` is the "Join the Glow" newsletter template for the Mailchimp audience the site's sign-up forms feed. It uses the site's palette (`#0a0a0f` background, `#ff6b35` orange, `#7b5cfa` violet) and fonts (Bebas Neue, DM Sans, DM Mono).

Images live in `img/` and are referenced at `https://hyphi.art/email/img/...`, so they load once this folder is deployed to Netlify. The `sample-*.jpg` files are crops of the product photos for the example issue; swap them per campaign.

## Using it in Mailchimp

1. **Content → Email templates → Create template → Code your own → Paste in code**, and paste `newsletter.html`.
2. Name it "Hyphi newsletter" and save. New campaigns can now pick it under **Saved templates**.
3. Each block marked `mc:edit` (hero title, story, cards, callout and so on) is editable in Mailchimp's editor without touching code.
4. For new images, upload to Mailchimp's Content Studio or drop them in `img/` here, and keep each under about 200 KB.

## Blocks

| Block | Notes |
| --- | --- |
| Top bar | Issue label plus a "View online" link (`*|ARCHIVE|*`). |
| Logo | `img/hyphi-logo.png`, the mark plus gradient wordmark baked into one image so it looks the same in every client. |
| Hero | Eyebrow, two-line Bebas headline with the second word in orange, intro, orange button. The button has a VML version so it renders in Outlook for Windows. |
| Hero image | 1200×800 source shown at 536px. |
| Feature story | Tag, headline with an orange italic phrase, body, "Read more" link. Copy the `<tr>` to add stories. |
| Product cards | Two cards side by side; they stack on phones. Images are 540×540. |
| Smart Sprout block | Wrapped in `*|IF:PRODUCT=smart-sprout|*`, so only people who signed up from that page see it. Change the slug to target `glow-flora-clip` or `glow-flora-home`, or delete the IF lines to show it to everyone. |
| For builders | Emoji icon list (OWLS, open hardware, right to repair). |
| Join the Glow | Callout asking readers to forward or share the sign-up link. |
| Footer | Links, tagline, and the address (`*|LIST:ADDRESSLINE|*`), preferences and unsubscribe links Mailchimp requires. |

## How it looks in each client

- **Apple Mail, iOS Mail, Thunderbird:** full brand fonts.
- **Gmail and Outlook:** web fonts are blocked, so headings fall back to Arial Narrow or Arial, still uppercase, and body text to Helvetica or Arial. The logo is an image, so it always matches.
- **Dark mode:** the email is already dark and declares `color-scheme: dark`, which keeps Apple Mail and Outlook from inverting it.

Before sending, use Mailchimp's **Preview → Send a test** to a Gmail and an iPhone address.
