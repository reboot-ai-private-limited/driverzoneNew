import type { ReactElement } from 'react';
import { HeroSlider } from '@/components/HeroSlider';
import { WhyChooseSection } from '@/components/WhyChooseSection';
import { ServicesSection } from '@/components/ServicesSection';
import { HowItWorksSection } from '@/components/HowItWorksSection';
import { CustomerAppSection } from '@/components/CustomerAppSection';
import { DriverWithUsSection } from '@/components/DriverWithUsSection';
import { DriverAppSection } from '@/components/DriverAppSection';
import { PromoBanner } from '@/components/PromoBanner';
import { TestimonialsSection } from '@/components/TestimonialsSection';

export default function HomePage(): ReactElement {
  return (
    <>
      <HeroSlider />
      <WhyChooseSection />
      <ServicesSection />
      <HowItWorksSection />
      <CustomerAppSection />
      <DriverWithUsSection />
      <DriverAppSection />
      <PromoBanner />
      <TestimonialsSection />
    </>
  );
}
