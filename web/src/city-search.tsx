import { useEffect, useId, useState, type KeyboardEvent } from 'react'
import { normalizeCityName } from './location'

type Place = [id: string, name: string, state: string]
let catalogue: Promise<Place[]> | undefined

function loadPlaces() {
  catalogue ??= fetch('/data/indian-cities.json')
    .then(async response => {
      if (!response.ok) throw new Error('City list unavailable.')
      return await response.json() as Place[]
    })
    .catch(error => {
      catalogue = undefined
      throw error
    })
  return catalogue
}

export function CitySearch({onSelect}: {onSelect: (name: string, id: string) => void}) {
  const listId = useId()
  const [query, setQuery] = useState('')
  const [places, setPlaces] = useState<Place[]>()
  const [failed, setFailed] = useState(false)
  const [active, setActive] = useState(-1)
  const prefix = normalizeCityName(query)
  const searching = prefix.length > 0

  useEffect(() => {
    if (!searching) return
    let current = true
    setFailed(false)
    loadPlaces().then(result => {
      if (current) setPlaces(result)
    }).catch(() => {
      if (current) setFailed(true)
    })
    return () => { current = false }
  }, [searching])

  const matches = searching && places
    ? places.filter(([, name]) => normalizeCityName(name).startsWith(prefix)).slice(0, 8)
    : []

  function handleKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (!matches.length) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = event.key === 'ArrowDown' ? (active + 1) % matches.length : active <= 0 ? matches.length - 1 : active - 1
      setActive(next)
      document.getElementById(listId + '-' + matches[next][0])?.scrollIntoView({block: 'nearest'})
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault()
      const [id, name] = matches[active]
      onSelect(name, id)
    }
  }

  return <div className="city-search form">
    <label>Search Indian cities
      <input role="combobox" aria-autocomplete="list" aria-expanded={matches.length > 0}
        aria-controls={matches.length ? listId : undefined}
        aria-activedescendant={matches[active] ? listId + '-' + matches[active][0] : undefined}
        autoComplete="off" placeholder="e.g. Fatehabad" value={query} maxLength={80} onKeyDown={handleKeys}
        onChange={event => {setQuery(event.target.value); setActive(-1)}}/>
    </label>
    {searching && !places && <p role="status">{failed ? 'City search is unavailable. Use your location or choose a preset below.' : 'Loading cities…'}</p>}
    {!!query.trim() && (!searching || (places && !matches.length)) && <p role="status">No matching city. Try a different spelling.</p>}
    {!!matches.length && <ul className="city-suggestions" id={listId} role="listbox" aria-label="Matching cities">
      {matches.map(([id, name, state], index) => <li key={id} role="presentation">
        <button type="button" role="option" id={listId + '-' + id} aria-selected={active === index} tabIndex={-1} onClick={() => onSelect(name, id)}>
          <span>{name}</span>{state && <small>{state}</small>}
        </button>
      </li>)}
    </ul>}
  </div>
}
