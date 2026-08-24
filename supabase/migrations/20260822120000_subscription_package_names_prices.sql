-- Align plan display titles + reference USD prices with final package matrix.

update public.app_subscription_plans set
  title = 'Couple / Çift Paketi (you + 1)',
  monthly_price_usd = 1.49
where code = 'duo';

update public.app_subscription_plans set
  title = 'Trio / Küçük Aile Paketi (you + 2)',
  monthly_price_usd = 1.99
where code = 'trio';

update public.app_subscription_plans set
  title = 'Family / Aile Paketi (you + 3)',
  monthly_price_usd = 2.49
where code = 'family';

update public.app_subscription_plans set
  title = 'Family Plus / Büyük Aile Paketi (you + 4)',
  monthly_price_usd = 2.99
where code = 'family_plus';

update public.app_subscription_plans set
  title = 'Extended Family / Geniş Aile Paketi (you + 5)',
  monthly_price_usd = 3.49
where code = 'extended';

update public.app_subscription_plans set
  title = 'Clan / Sülale Paketi (you + 6)',
  monthly_price_usd = 3.99
where code = 'clan';

update public.app_subscription_plans set
  title = 'Circle / Geniş Sülale Paketi (you + 7)',
  monthly_price_usd = 4.49
where code = 'circle';
