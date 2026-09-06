import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRightIcon } from '@phosphor-icons/react';
import { useSession } from '../lib';
import { Notice } from '../components/ui';
export const Route = createFileRoute('/login')({ component: Login });
function Login() {
  const { data, error } = useSession();
  return (
    <section className="signin-panel">
      <span className="eyebrow">A MARKET FOR YOUR CURIOSITY</span>
      <h1>Bring your perspective.</h1>
      <p>
        Start with 10,000 free play dollars. Trade outcome shares, create questions, and learn from
        the results.
      </p>
      {data?.user ? (
        <Link to="/portfolio" className="button">
          Go to your portfolio <ArrowUpRightIcon size={18} />
        </Link>
      ) : data?.googleEnabled ? (
        <a className="button" href="/auth/google">
          Continue with Google <ArrowUpRightIcon size={18} />
        </a>
      ) : (
        <Notice>
          {error
            ? 'Could not reach sign-in. Please refresh to try again.'
            : data
              ? 'Sign-in is temporarily unavailable. You can still explore the markets.'
              : 'Checking sign-in availability…'}
        </Notice>
      )}
      <small>No deposits. No cash-out. No monetary prizes.</small>
      <p>
        <Link to="/">Explore markets</Link>
      </p>
    </section>
  );
}
