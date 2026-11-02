import type { ConditionSemantic } from '../../domain/conditions';
import clearIcon from '../../assets/icons/clear.svg';
import cloudIcon from '../../assets/icons/cloud.svg';
import fogIcon from '../../assets/icons/fog.svg';
import precipitationIcon from '../../assets/icons/precipitation.svg';
import stormIcon from '../../assets/icons/storm.svg';
import unknownIcon from '../../assets/icons/unknown.svg';

function iconFor(key: ConditionSemantic['iconKey']): string {
  if (key === 'clear' || key === 'mainly-clear') return clearIcon;
  if (key === 'partly-cloudy' || key === 'overcast') return cloudIcon;
  if (key === 'fog' || key === 'rime-fog') return fogIcon;
  if (key.startsWith('thunderstorm')) return stormIcon;
  if (
    key.startsWith('rain') ||
    key.startsWith('drizzle') ||
    key.startsWith('freezing') ||
    key.startsWith('snow')
  ) {
    return precipitationIcon;
  }
  return unknownIcon;
}

export function ConditionIcon({
  condition,
}: {
  readonly condition: ConditionSemantic;
}) {
  return (
    <img
      alt={`${condition.description} condition icon`}
      className="condition-icon"
      height="64"
      src={iconFor(condition.iconKey)}
      width="64"
    />
  );
}
