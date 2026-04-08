import { LitElement, html, css } from 'https://cdn.jsdelivr.net/gh/lit/dist@2/all/lit-all.min.js';

export class ForkYeahInfoCard extends LitElement {
  static get tag() {
    return "forkyeah-infocard";
  }

  static get properties() {
    return {
      title: { type: String },
      subtitle: { type: String },
      description: { type: String },
      image: { type: String },
    };
  }

  constructor() {
    super();
    this.title = "Restaurant Name";
    this.subtitle = "Country / Cuisine";
    this.description = "Short description of the restaurant.";
    this.image = "https://source.unsplash.com/400x300/?food";
  }

  static get styles() {
    return css`
      .card {
        width: 250px;
        border-radius: 12px;
        overflow: hidden;
        background: white;
        box-shadow: 0 4px 10px rgba(0,0,0,0.1);
        font-family: 'Inter', sans-serif;
        transition: transform 0.2s ease;
      }

      .card:hover {
        transform: translateY(-5px);
      }

      img {
        width: 100%;
        height: 150px;
        object-fit: cover;
      }

      .content {
        padding: 12px;
      }

      h3 {
        margin: 0 0 5px;
        font-size: 1.1rem;
      }

      .subtitle {
        font-size: 0.9rem;
        color: #666;
        margin-bottom: 8px;
      }

      p {
        font-size: 0.85rem;
        color: #444;
        margin: 0;
      }
    `;
  }

  render() {
    return html`
      <div class="card">
        <img src="${this.image}" alt="${this.title}" />
        <div class="content">
          <h3>${this.title}</h3>
          <div class="subtitle">${this.subtitle}</div>
          <p>${this.description}</p>
        </div>
      </div>
    `;
  }
}

customElements.define(ForkYeahInfoCard.tag, ForkYeahInfoCard);