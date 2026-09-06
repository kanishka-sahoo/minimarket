import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeftIcon, PlusIcon, TrashIcon, ArrowUpRightIcon } from '@phosphor-icons/react';
import { categories, marketSchema } from '@minimarket/shared';
import { useAction, useSession } from '../lib';
import { Notice, SignIn, TableSkeleton } from '../components/ui';
export const Route = createFileRoute('/create')({ component: CreateMarket });
function CreateMarket() {
  const { data: session, isLoading } = useSession();
  const navigate = useNavigate();
  const action = useAction<{ id: string }>();
  const [kind, setKind] = useState<'binary' | 'multi'>('binary'),
    [outcomes, setOutcomes] = useState(['Outcome A', 'Outcome B', 'Other']),
    [error, setError] = useState('');
  if (isLoading) return <TableSkeleton rows={5} />;
  if (!session?.user) return <SignIn />;
  return (
    <div className="form-layout">
      <section>
        <Link to="/" className="back-link">
          <ArrowLeftIcon size={15} /> All markets
        </Link>
        <h1>What are you wondering?</h1>
        <p className="lede">Make it specific. Make it verifiable. Let the market weigh in.</p>
        <form
          className="market-form"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            const data = new FormData(e.currentTarget);
            const close = data.get('closesAt') as string;
            const parsed = marketSchema.safeParse({
              title: data.get('title'),
              category: data.get('category'),
              criteria: data.get('criteria'),
              source: data.get('source'),
              closesAt: new Date(close).toISOString(),
              kind,
              outcomes: kind === 'binary' ? ['Yes', 'No'] : outcomes,
            });
            if (!parsed.success) {
              setError(parsed.error.issues.map((x) => x.message).join('; '));
              return;
            }
            action.mutate(
              { path: '/api/markets', body: parsed.data },
              { onSuccess: (r) => void navigate({ to: '/markets/$id', params: { id: r.id } }) },
            );
          }}
        >
          <label>
            Your question
            <input
              name="title"
              required
              minLength={12}
              maxLength={180}
              placeholder="Will a specific event happen by a specific date?"
            />
          </label>
          <div className="form-row">
            <label>
              Category
              <select name="category">
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              Trading closes · your local time
              <input type="datetime-local" name="closesAt" required />
            </label>
          </div>
          <fieldset>
            <legend>Market type</legend>
            <div className="choice-buttons">
              <button
                type="button"
                className={kind === 'binary' ? 'selected' : ''}
                onClick={() => setKind('binary')}
              >
                <strong>Yes or no</strong>
                <small>One question. Two possibilities.</small>
              </button>
              <button
                type="button"
                className={kind === 'multi' ? 'selected' : ''}
                onClick={() => setKind('multi')}
              >
                <strong>Multiple outcomes</strong>
                <small>2-8 choices. Exactly one winner.</small>
              </button>
            </div>
          </fieldset>
          {kind === 'multi' && (
            <fieldset>
              <legend>Outcomes · cover every possibility</legend>
              {outcomes.map((o, i) => (
                <div className="outcome-input" key={i}>
                  <input
                    aria-label={`Outcome ${i + 1}`}
                    required
                    maxLength={60}
                    value={o}
                    onChange={(e) =>
                      setOutcomes(outcomes.map((v, j) => (j === i ? e.target.value : v)))
                    }
                  />
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Remove outcome ${i + 1}`}
                    disabled={outcomes.length <= 2}
                    onClick={() => setOutcomes(outcomes.filter((_, j) => j !== i))}
                  >
                    <TrashIcon size={18} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="text-button"
                disabled={outcomes.length >= 8}
                onClick={() => setOutcomes([...outcomes, ''])}
              >
                <PlusIcon size={15} /> Add outcome
              </button>
            </fieldset>
          )}
          <label>
            Resolution criteria
            <textarea
              name="criteria"
              required
              minLength={30}
              maxLength={4000}
              rows={5}
              placeholder="Describe exactly what makes each outcome win, the evidence an admin should use, and how ambiguous cases should be handled."
            />
          </label>
          <label>
            Evidence source URL
            <input name="source" type="url" required placeholder="https://…" />
            <small>Use an authoritative source that an administrator can verify.</small>
          </label>
          <label className="checkbox-label">
            <input type="checkbox" required /> I understand these terms become permanent on
            publication and only admins can settle this market.
          </label>
          {(error || action.isError) && <Notice error>{error || action.error?.message}</Notice>}
          <button disabled={action.isPending} type="submit">
            {action.isPending ? 'Publishing…' : 'Publish market'} <ArrowUpRightIcon size={18} />
          </button>
        </form>
      </section>
      <aside className="writing-guide">
        <h2>A good question has a clear finish line.</h2>
        <ol>
          <li>
            <strong>Be precise</strong>
            <p>Define the event, deadline, and the source of truth.</p>
          </li>
          <li>
            <strong>Cover every outcome</strong>
            <p>Include “Other” when your choices might miss a possibility.</p>
          </li>
          <li>
            <strong>Keep it fair</strong>
            <p>You can’t edit terms or choose the winner after publishing.</p>
          </li>
        </ol>
        <Notice>Your market publishes immediately.</Notice>
      </aside>
    </div>
  );
}
