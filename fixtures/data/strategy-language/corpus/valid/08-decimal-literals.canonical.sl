version v1

const low = 1.5
const high = 2.0
const tiny = 0.000001

if has_real_margin() and real_margin_ratio() > low - high + tiny then
    return stay
end

return stay
