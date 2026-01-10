<script setup lang="ts">
import beforeHtml from "./how-it-works.before.txt?shiki&lang=ts";
import afterHtml from "./how-it-works.after.txt?shiki&lang=ts";
</script>

<template>
  <section class="how-it-works">
    <div class="container">
      <h2 class="title">Delete Your WebSocket Code</h2>
      <p class="subtitle">
        Stop maintaining connection state machines. Sideband handles reconnects,
        multiplexing, and NAT traversal so you can focus on your app.
      </p>

      <div class="comparison">
        <div class="code-block before">
          <div class="code-header">
            <span class="label">Before</span>
            <span class="tech">DIY WebSocket</span>
          </div>
          <div class="shiki-wrapper" v-html="beforeHtml" />
        </div>

        <div class="code-block after">
          <div class="code-header">
            <span class="label">After</span>
            <span class="tech">Sideband SDK</span>
          </div>
          <div class="shiki-wrapper" v-html="afterHtml" />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.how-it-works {
  padding: 64px 24px;
  background: var(--vp-c-bg);
}

@media (min-width: 640px) {
  .how-it-works {
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

.comparison {
  display: grid;
  gap: 24px;
}

@media (min-width: 960px) {
  .comparison {
    grid-template-columns: 1fr 1fr;
    gap: 32px;
  }
}

.code-block {
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--vp-c-bg-alt);
  border-bottom: 1px solid var(--vp-c-divider);
}

.label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.before .label {
  color: var(--vp-c-danger-1);
}

.after .label {
  color: var(--vp-c-brand-1);
}

.tech {
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.shiki-wrapper :deep(pre) {
  margin: 0;
  padding: 16px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
  background: transparent !important;
}

.shiki-wrapper :deep(code) {
  font-family: var(--vp-font-family-mono);
}

/* Dual theme: light visible by default, dark in .dark mode */
.shiki-wrapper :deep(.shiki span) {
  color: var(--shiki-light);
}

.dark .shiki-wrapper :deep(.shiki span) {
  color: var(--shiki-dark);
}
</style>
