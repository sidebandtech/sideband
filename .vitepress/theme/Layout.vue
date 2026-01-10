<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import { useData } from "vitepress";
import HeroExtras from "./components/HeroExtras.vue";
import FramingLine from "./components/FramingLine.vue";
import HowItWorks from "./components/HowItWorks.vue";
import ComparisonTable from "./components/ComparisonTable.vue";
import UseCases from "./components/UseCases.vue";
import TrustSignals from "./components/TrustSignals.vue";
import CallToAction from "./components/CallToAction.vue";

const { Layout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
  <Layout>
    <template #home-hero-actions-after>
      <HeroExtras v-if="frontmatter.layout === 'home'" />
    </template>

    <template #home-features-after>
      <template v-if="frontmatter.layout === 'home'">
        <HowItWorks />
        <ComparisonTable />
        <UseCases />
        <TrustSignals />
        <CallToAction />
      </template>
    </template>
  </Layout>
</template>
