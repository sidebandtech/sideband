<script setup lang="ts">
const features = [
  {
    name: "No WebSocket code",
    sideband: true,
    diy: false,
    ngrok: true,
    tailscale: true,
    firebase: true,
  },
  {
    name: "Works behind NAT",
    sideband: true,
    diy: false,
    ngrok: true,
    tailscale: true,
    firebase: true,
  },
  {
    name: "End-to-end encrypted",
    sideband: true,
    diy: false,
    ngrok: false,
    tailscale: true,
    firebase: false,
  },
  {
    name: "No interstitial pages",
    sideband: true,
    diy: true,
    ngrok: false,
    tailscale: true,
    firebase: true,
  },
  {
    name: "No account required",
    sideband: true,
    diy: true,
    ngrok: false,
    tailscale: false,
    firebase: false,
  },
  {
    name: "Self-hostable relay",
    sideband: true,
    diy: true,
    ngrok: false,
    tailscale: true,
    firebase: false,
  },
  {
    name: "TypeScript SDK",
    sideband: true,
    diy: false,
    ngrok: false,
    tailscale: false,
    firebase: true,
  },
];

const alternatives = [
  { key: "sideband", label: "Sideband", highlight: true },
  { key: "diy", label: "DIY WebSocket", highlight: false },
  { key: "ngrok", label: "ngrok", highlight: false },
  { key: "tailscale", label: "Tailscale", highlight: false },
  { key: "firebase", label: "Firebase", highlight: false },
];
</script>

<template>
  <section class="comparison-table">
    <div class="container">
      <h2 class="title">Why Sideband?</h2>
      <p class="subtitle">
        Compare with common alternatives for browser-to-daemon communication.
      </p>

      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th class="feature-col"></th>
              <th
                v-for="alt in alternatives"
                :key="alt.key"
                :class="{ highlight: alt.highlight }"
              >
                {{ alt.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="feature in features" :key="feature.name">
              <td class="feature-name">{{ feature.name }}</td>
              <td
                v-for="alt in alternatives"
                :key="alt.key"
                :class="{ highlight: alt.highlight }"
              >
                <span
                  v-if="feature[alt.key as keyof typeof feature]"
                  class="check"
                >
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <path
                      d="M16.667 5L7.5 14.167 3.333 10"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </span>
                <span v-else class="dash">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.comparison-table {
  padding: 64px 24px;
  background: var(--vp-c-bg-soft);
}

@media (min-width: 640px) {
  .comparison-table {
    padding: 96px 48px;
  }
}

.container {
  max-width: 1152px;
  margin: 0 auto;
}

.title {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
  margin-bottom: 16px;
}

@media (min-width: 640px) {
  .title {
    font-size: 40px;
  }
}

.subtitle {
  font-size: 18px;
  color: var(--vp-c-text-2);
  text-align: center;
  max-width: 640px;
  margin: 0 auto 48px;
  line-height: 1.6;
}

.table-wrapper {
  overflow-x: auto;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 640px;
}

th,
td {
  padding: 16px;
  text-align: center;
  border-bottom: 1px solid var(--vp-c-divider);
}

th {
  font-size: 14px;
  font-weight: 600;
  background: var(--vp-c-bg-alt);
}

th.feature-col {
  width: 200px;
}

th.highlight {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

td.highlight {
  background: var(--vp-c-brand-soft);
}

.feature-name {
  text-align: left;
  font-weight: 500;
  color: var(--vp-c-text-1);
  white-space: nowrap;
}

tbody tr:last-child td {
  border-bottom: none;
}

.check {
  color: var(--vp-c-brand-1);
  display: inline-flex;
}

.highlight .check {
  color: var(--vp-c-brand-1);
}

.dash {
  color: var(--vp-c-text-3);
}
</style>
