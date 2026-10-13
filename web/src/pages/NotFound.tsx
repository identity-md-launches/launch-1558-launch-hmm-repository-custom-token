import { EmptyPond } from '../components/states'

export default function NotFound() {
  return (
    <div className="page page-narrow">
      <EmptyPond title="Nothing in this part of the pond" body="The page you were looking for isn't here." cta={{ to: '/', label: 'Back to the pond' }} />
    </div>
  )
}
