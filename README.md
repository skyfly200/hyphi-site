# hyphi-site

Static site for [hyphi.art](https://hyphi.art), deployed on Netlify. No build step: `index.html` is the homepage and each product page lives at `products/<slug>/index.html`, sharing `products/product.css` and `products/product.js`.

## Product pages

- **Photos:** each `<li data-src="images/NN.jpg" data-label="...">` in a page's `.thumbs` list is one photo slot. Drop a file at that path and it shows up; until then the slot renders a placeholder naming the file it expects.
- **3D explorer:** set `data-model="models/<name>.glb"` (and optionally `data-poster`) on the page's `.media` div to get a Photos/3D toggle. `<model-viewer>` loads from the CDN only when someone opens 3D.

## Mailchimp sign-ups and the `PRODUCT` field

Any element with `data-signup="<product-slug>"` opens the sign-up modal (see `products/product.js`). The modal posts to the same Mailchimp audience as the homepage form, plus a hidden `PRODUCT` merge field set to the slug, e.g. `glow-flora-clip`, `glow-flora-home` or `smart-sprout`. The homepage form doesn't send `PRODUCT`, so those subscribers have it blank.

As far as I know, Mailchimp doesn't update an existing subscriber's fields when they sign up again through an embedded form. So `PRODUCT` usually holds the **first** product someone signed up from.

Ways to use it later:

- **Segments:** in Mailchimp, build a segment where `PRODUCT` *is* `smart-sprout` to email only people waiting on that product, e.g. a launch or restock announcement.
- **Automations:** trigger a welcome email per product when a contact joins with a given `PRODUCT`, e.g. Glow Flora care tips or the Hub app link for Smart Sprout.
- **Demand signal:** export the audience or check the field's report to see which product draws the most sign-ups before deciding what to build or restock.
- **Merge tag in emails:** use `*|PRODUCT|*` in an email to personalise copy ("You asked about *|PRODUCT|*...").
- **New products:** to track a new page, give its button `data-signup="<new-slug>"`. Nothing needs to change in Mailchimp.
- **Other entry points:** any button on the site can use `data-signup` to track where people signed up, e.g. `data-signup="owls"` on the OWLS card. Pages other than product pages also need `product.css`/`product.js` loaded, and `data-signup-name` sets the name shown in the modal title.
