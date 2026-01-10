<template>
  <div class="framing-line">
    <p>Sideband is for the moment you stop shipping "localhost-only."</p>
  </div>
</template>

<style scoped>
.framing-line {
  max-width: 1152px;
  margin: 0 auto;
  padding: 48px 24px 0;
  text-align: center;
}

@media (min-width: 640px) {
  .framing-line {
    padding: 32px 48px 0;
  }
}

.framing-line p {
  font-size: 18px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  font-style: italic;
}

@media (min-width: 640px) {
  .framing-line p {
    font-size: 20px;
  }
}
</style>
